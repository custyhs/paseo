## Context

See proposal.md for motivation. The core implementation being ported is `packages/server/src/server/drafts/draft-storage.ts` (531 lines), `packages/server/src/server/session/draft/draft-session.ts` (425), `packages/protocol/src/draft/{types,rpc-schemas}.ts` (362), and under `packages/app/src/drafts/` the framework-free logic `model.ts`, `save-loop.ts`, `checkpoint.ts`, `send-revision.ts` (654) plus React UI in `draft-editor.tsx`, `send-sheet.tsx`, `plan-sheet.tsx`, `snapshot-sheet.tsx`, `context.tsx`, `screens/drafts-screen.tsx`, and `panels/scratchpad-panel.tsx` (2,263). Its behaviour contract is `openspec/specs/durable-drafts/spec.md`.

The plugin runtime constrains the port:

- Client code is compiled once by the daemon's esbuild and evaluated in every connected app. Host modules are limited to `react`, `react-native`, `zod`, `@tanstack/react-query`, and the SDK entries; other packages are bundled from the plugin's own `node_modules`. No Metro platform files, no `@/` app imports, no Unistyles, no app i18n, no Expo Router, no device-local storage API.
- Server code runs in a daemon subprocess with Node access and its own `PaseoApi`; RPC handlers are request/response only. There is no push channel to clients and no sanctioned per-plugin data directory.
- Surfaces receive `theme`, `host`, `layout`, and optional `navigation`; panels add `workspaceId`. Paseo owns routes, headers, host picker, tab persistence, and error boundaries. All plugin RPCs run under `daemon.manage`.
- Two SDK versions are in play: this fork's `packages/plugin` is `0.8.0-beta.1`; npm's latest is `0.8.0`. The scaffold from `paseo plugin init` pins `0.8.0-beta.1` and writes `>=0.8.0-beta.1`.

## Goals / Non-Goals

**Goals:**

- Port storage, search, and the client's pure logic with their tests, so the behaviours the core tests already pin are inherited rather than re-derived.
- Rewrite only the UI, against RN primitives and the host UI the SDK exports, in a shape that works on web, Electron, iOS, and Android.
- Make the plugin installable on a stock 0.8 host and on this fork's dev daemon with the same manifest.
- Leave the fork's core drafts untouched so either can be disabled while the other is evaluated.

**Non-Goals:**

- Matching the core screen pixel for pixel; the layout follows the plugin host UI contract instead.
- A push channel, cross-host aggregation, per-operation permissions, or a native checkpoint. These are sandbox limits, recorded in the spec as behaviour, not worked around.
- Slash commands or an attachment source. `yannelli/paseo-prompt-manager` already covers "attach a saved prompt"; a draft is sent, not attached.
- Retiring core drafts or touching the production daemon.

## Decisions

### 1. Standalone repository built from the official scaffold

`~/projects/paseo-drafts`, initialised with `paseo plugin init`, then reshaped: manifest id `paseo-drafts`, `requirements.paseo` raised to `>=0.8.0` (the documented prerelease rule makes `0.8.0-beta.1` satisfy it), `@getpaseo/plugin` dev dependency pinned to `0.8.0` so typechecking runs against the SDK the second machine most likely has. Layout follows the scaffold's `shared/`, `server/`, `client/` boundaries; nothing else in the plugin root.

Alternative rejected: a subdirectory of this fork installed with the `owner/repo:path` shorthand. It would make the second machine clone the whole monorepo, and it ties the plugin's history to the fork's rebase cadence.

### 2. Port, do not redesign

`shared/records.ts` is `protocol/src/draft/types.ts` unchanged. `server/storage.ts` is `draft-storage.ts` with the logger interface narrowed and the change-listener kept for future use. `server/search.ts` is the search branch of `draft-session.ts` with its `excerptAround` and scoring. `client/model.ts`, `client/save-loop.ts`, and `client/checkpoint.ts` are the app modules with their imports rewritten. Each brings its test file, translated from vitest to `node:test`.

Alternative rejected: a simplified model without plans or a dispatch log. It would drop the Scratchpad's two sections and the derived planned-here rule, which is the feature's point.

### 3. Sending is one server RPC; the client only flushes first

`drafts.send({ artifactId, target })` runs in the subprocess: capture the snapshot at the current version (idempotent per revision, as in core), resolve the workspace directory through `paseo.workspaces`, then either `paseo.agents.create({ config: { provider }, cwd, prompt: snapshot.body, clientMessageId, labels })` for a new agent or `paseo.agents.ref(agentId).send(body, { messageId })` for an existing one, then append the dispatch as `sent` with the agent id or as `failed` with the error. Delivery failure is a normal response carrying the failed dispatch; only invalid input or an unknown draft throws. The client keeps core's `sendRevision` barrier: flush the save loop, refuse on `unsaved` or `conflict`, then call the RPC.

The wire target for a new agent carries `provider` in Paseo's `provider/model` form, chosen in the send modal from `paseo.providers.list()`; core kept provider selection client-side for the same reason and this design does too, it just moves the delivery hop.

Alternative rejected: core's two-phase capture → client delivery → settle. In the sandbox it costs an extra round trip and reintroduces the permanent `pending` dispatch when a client disconnects between the halves.

### 4. Plugin-owned storage with a plugin-owned config file

`server/paths.ts` resolves `$XDG_CONFIG_HOME/paseo/drafts`, falling back to `~/.config/paseo/drafts`, unless an override names another absolute directory (a `~/` prefix is expanded; a relative path is refused and reported). The override lives in the plugin's own file, `<config>/paseo/paseo-drafts.json`, read and written through the `drafts.get_config` and `drafts.set_config` RPCs, because the SDK's `registerSettings` gives server code no way to read the values it stores and the store must know its directory before the first request. This is the arrangement `yannelli/paseo-prompt-manager` uses for the same reason. `language` stays in the SDK settings document, since only the client reads it.

`index.server.ts` opens one store for the resolved directory. A directory change flushes and disposes the old store and opens the new one without a daemon restart. Initialization failure is stored as the store's error and every handler rethrows it with the directory in the message; the client renders it as the storage-unavailable state. This replaces core's "stop advertising the capability" because a plugin cannot un-advertise itself.

Alternative rejected: sharing `$PASEO_HOME/drafts` with core. The user chose isolation; two writers on one directory is also a real hazard while both implementations exist on this machine. Alternative rejected: carrying `directory` in the settings document and having the client pass it with every RPC; that makes a host-side fact depend on whichever client spoke last.

### 5. Freshness by polling through react-query

Each host installation has its own query client. Queries are keyed `["drafts", "list", includeArchived]`, `["drafts", "detail", id]`, `["drafts", "snapshot", id, rev]`, `["drafts", "search", query]`. List and detail queries poll every 15 seconds while a surface or panel is mounted and refetch on window focus; every mutation invalidates list and detail on success. Conflict correctness does not depend on this: `baseVersion` on the host rejects stale writes regardless of how fresh the client's copy is.

Alternative: none in the sandbox. Plugin RPC has no server-initiated messages, and `paseo.agents.subscribe` carries agent events only.

### 6. The checkpoint lives in `client/web.ts`

`client/checkpoint.ts` keeps core's store logic against a `CheckpointStorage` interface. `client/web.ts` declares only the `indexedDB` globals it uses, exports a storage that is IndexedDB when `Platform.OS === "web"` and an in-memory no-op otherwise, and is the only file that touches a browser global. The editor gates on `store.isLoaded()` before painting, as core does. Native clients therefore behave as core did before the checkpoint fix: pending text survives within the session and is reported as not saved.

Alternative rejected: `localStorage`. Core's comment stands: writes are synchronous on the main thread and one is issued per keystroke.

### 7. UI on RN primitives and the host UI contract

Components use `View`, `Text`, `Pressable`, `TextInput`, `FlatList`, and `ScrollView` from `react-native` and the SDK's `Modal`, `Icon`, `ScrollView`, `FlatList`, `TextInput`, `useToast`, and `copyText`. Colours come only from `theme.colors` (`surface0..2`, `border`, `foreground`, `foregroundMuted`, `accent`, `accentForeground`, `statusSuccess/Warning/Danger`); spacing from `layout.compact`. `client/ui/` holds the few local primitives the core screens need: a button, a chip, a status line, a section header, a row. Wide layouts split list and editor side by side; compact layouts stack them with a back affordance. Send, plan, and snapshot are `Modal`s. The settings screen uses `SettingsSection`, `SettingsCard`, `SettingsSelect`, `SettingsInput`, `SettingsAction` from `@getpaseo/plugin/client/ui`; the language row writes the settings document, the directory row calls `drafts.set_config`.

Workspace, agent, project, and provider lists come from `usePaseo()` (`workspaces.list`, `agents.list`, `projects.list`, `providers.list`) cached in react-query with a 30-second stale time; `useWorkspace` and `useAgent` selectors serve the panel's own context.

### 8. Bilingual strings carried by the plugin

`client/i18n.ts` holds `en` and `zh-CN` dictionaries copied from `packages/app/src/i18n/resources/drafts.ts` plus the strings the plugin adds (settings labels, storage error, permission error, host unreachable). `useStrings()` reads `preferences.language`; `auto` resolves with `Intl.DateTimeFormat().resolvedOptions().locale`, which Hermes and browsers both provide. Interpolation is the same `{{name}}` form so the copied strings stay verbatim.

### 9. Contributions

`index.client.tsx` registers: surface `drafts` with sidebar item "Drafts" (icon `NotebookPen`); workspace panel `scratchpad` (`context: "workspace"`, `locations: ["workspace", "explorer"]`, icon `PenLine`); settings screen `preferences`; Command Center item `new-draft` in global and workspace contexts. The panel opens the full surface through `openSurface("drafts")` from a Command Center callback closure captured at registration, since panel props expose only agent and workspace navigation. `index.server.ts` registers the settings definition and the eleven handlers (nine draft operations plus the two config calls) and returns an async cleanup that flushes the store.

### 10. Tests without a bundler

Node 24's `node --test` with `--experimental-strip-types` runs `server/*.test.ts` and `client/*.test.ts` for logic modules that import nothing from React or the SDK client entry. Components are covered by `tsc --noEmit` and by QA on the dev daemon. This mirrors `yannelli/paseo-prompt-manager` and keeps the repository free of vitest and jsdom.

## Risks / Trade-offs

- [SDK 0.8.0 differs from this fork's 0.8.0-beta.1 in a type the plugin uses] → typecheck against the published 0.8.0; QA on the fork's beta.1 runtime; keep to APIs the public reference documents.
- [`paseo.agents.create` needs a `cwd`; the plugin only has a workspace id] → resolve through `paseo.workspaces.list()` in the send handler; a workspace that cannot be found fails the send with a clear reason and a failed dispatch.
- [15-second staleness surprises a user editing on two devices] → the conflict bar is the safety net; the interval is a single constant, and the spec states the bound.
- [Paseo hides plugin surfaces while the host is disconnected] → typing while fully offline is impossible for any plugin; the checkpoint covers writes the host refuses and text typed before a disconnect, and the editor retries every five seconds so reconnecting needs no keystroke. Verified on the dev daemon: the surface reads "This plugin surface is unavailable." until the host returns.
- [The host bumps the version on plan and archive changes] → the editor adopts the version those mutations return, otherwise the next keystroke is refused as a conflict. Found in QA; covered by the send and plan flows.
- [Bundled IndexedDB code evaluated on Hermes] → no top-level browser access; `client/web.ts` declares its globals and gates every export on `Platform.OS`; the QA matrix loads the bundle on a native client.
- [A large draft body in an RPC] → bodies are text; the 64 KiB limit applies to timeline items, not RPC payloads. If a limit surfaces during QA, record it in the README as a known bound.
- [`daemon.manage` for reads] → accepted by the user; the spec says so and the surface shows the permission error.
- [Directory setting pointing at a path the daemon user cannot write] → the store reports the error per operation and the settings screen shows it; the previous directory is untouched.
- [Auto language detection guesses wrong] → the setting can be pinned; the default only chooses the first render.

## Migration Plan

1. Build the plugin at `~/projects/paseo-drafts` with its unit tests and `npm run typecheck` green.
2. QA on the checkout's dev daemon: set `pluginsEnabled: true` in `.dev/paseo-home/config.json`, start `npm run dev` (port 6768), install with `npm run cli -- plugin install ~/projects/paseo-drafts`, drive the web app already served on 8081 with the Paseo browser tools, and walk every spec scenario with screenshots. Fix, `paseo plugin reload`, repeat.
3. Publish: create the public GitHub repository `custyhs/paseo-drafts`, push, tag `v0.1.0`, and verify `paseo plugin add custyhs/paseo-drafts --ref v0.1.0` installs on the dev daemon from Git after the directory source is removed.
4. On the second machine: enable plugins under Settings → Plugins, run `paseo plugin add custyhs/paseo-drafts`, open Drafts.
5. Rollback on any host is `paseo plugin remove paseo-drafts`; draft files stay in the storage directory. The core implementation on this fork keeps working independently because the two never share a directory.

## Open Questions

- The exact Paseo version on the second machine is unknown; the manifest range covers 0.8.0-beta.1 and 0.8.0. If it runs 0.7.x the daemon must be updated first.
