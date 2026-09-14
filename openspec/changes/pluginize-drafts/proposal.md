## Why

The drafts feature imported in `2026-09-10-import-drafts` lives in core: nine `draft.*` RPCs in `packages/protocol`, a store and a session handler in `packages/server`, and a screen, a panel, a tab kind, and a nav row in `packages/app`. Every one of those registration points is upstream code that upstream keeps reshaping, so the feature is a standing rebase cost, and it can only be used from this fork's own desktop build. Phones run upstream's store builds and never see it.

Paseo 0.8 ships a plugin system whose extension points cover everything drafts needs: a global surface with a sidebar item, workspace panels that the host persists and restores, Zod-validated RPCs handled in a daemon-side subprocess with Node access, host-scoped settings, and the same `PaseoApi` for creating agents and sending prompts. Upstream's contributing guide directs specialized workflows to plugins, and a comparable prompt-library plugin already ships on the stock app. Rebuilding drafts as a plugin makes it installable on any 0.8 host with one command, delivers the client to every connected app including phones, and removes the largest custom feature from the fork's rebase surface.

## What Changes

- **A standalone plugin, `paseo-drafts`, in its own public repository `custyhs/paseo-drafts`.** Installed with `paseo plugin add custyhs/paseo-drafts`; requires Paseo `>=0.8.0`, which the prerelease rule also satisfies for `0.8.0-beta.1`. Built from the official `paseo plugin init` scaffold with the SDK boundaries it enforces.
- **Feature parity with the core implementation** for everything the plugin sandbox can express: the Drafts surface with search and archive, the Scratchpad workspace panel, autosave with optimistic concurrency and an explicit conflict choice, declared plans with derived planned-here status, immutable send snapshots and the dispatch log, search across current bodies and sent revisions, and a web-side offline checkpoint.
- **Sending becomes one host-side operation.** Core sends in two phases with the client in the middle; the plugin's daemon subprocess captures the snapshot, delivers it through `PaseoApi`, and records the outcome in one request, so a client that disconnects mid-send cannot leave a dispatch pending forever.
- **Storage is plugin-owned.** Drafts live under `~/.config/paseo/drafts` (honouring `XDG_CONFIG_HOME`), changeable in the plugin's settings, in the same three-file layout core uses, so a directory copied from `$PASEO_HOME/drafts` reads unchanged. Core's data on this machine is not shared with the plugin.
- **A bilingual interface.** English and Simplified Chinese dictionaries carried by the plugin, selected by a host-scoped setting whose default follows the device locale.
- **Four behaviours change shape** because the sandbox has no equivalent: the list is per host with the host picker Paseo adds, instead of one aggregated list; every operation requires the host's manage permission, because all plugin RPCs do; the offline checkpoint exists only on web clients; other clients' edits appear on a polling interval rather than a push.
- **Out of scope:** removing the core drafts implementation from the fork (a later change once the plugin is proven), installing the plugin on this machine's production daemon (the user's call), attachments, scheduled sends, cross-host sync, templates.

## Capabilities

### New Capabilities

- `drafts-plugin`: the durable-drafts behaviour delivered as an installable Paseo plugin — installation and compatibility, plugin-owned storage, the per-host Drafts surface, the Scratchpad panel, autosave and conflicts, plans and derived status, host-side sending with snapshots and the dispatch log, search, archive, the web checkpoint, freshness by polling, and the language setting.

### Modified Capabilities

None. `durable-drafts` continues to describe the core implementation, which this change leaves in place. Retiring it is a separate change.

## Impact

- **New repository:** `custyhs/paseo-drafts` at `~/projects/paseo-drafts` on this machine — `paseo-plugin.json`, `index.client.tsx`, `index.server.ts`, `shared/`, `server/`, `client/`, its own `package.json` and lockfile, `node --test` unit tests, MIT license, README.
- **Runtime dependencies:** none beyond what Paseo supplies to plugins (`react`, `react-native`, `zod`, `@tanstack/react-query`, the SDK entries). Development dependencies are the scaffold's, pinned to `@getpaseo/plugin@0.8.0`.
- **New host-side storage:** `~/.config/paseo/drafts/<artifactId>/` with `artifact.json`, `snapshots/NNNN.json`, `dispatches.jsonl`; plugin settings persisted by Paseo per installation.
- **New client-side storage:** IndexedDB database `paseo-drafts-checkpoints` on web clients only.
- **Host requirements:** `pluginsEnabled` on the target daemon, Paseo `>=0.8.0-beta.1` on both daemon and app.
- **This fork:** only this change's planning files. QA uses the checkout's dev daemon (`.dev/paseo-home`, port 6768), which needs `pluginsEnabled: true` in its dev-home config; the production daemon on 6767 is not touched.

## Upstream impact

No upstream file is modified. The plugin is a separate repository, and the fork gains only `openspec/changes/pluginize-drafts/`. Rebase risk: none.

| Type              | Location                                           | Conflict risk |
| ----------------- | -------------------------------------------------- | ------------- |
| New, outside fork | `custyhs/paseo-drafts` (all plugin code and tests) | none          |
| New, inside fork  | `openspec/changes/pluginize-drafts/*`              | none          |
| Modified upstream | —                                                  | —             |

The follow-on change that removes core drafts will delete the thirty-eight upstream-file edits listed in the archived import's proposal; that deletion is where the rebase benefit is realised.
