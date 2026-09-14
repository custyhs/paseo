## 1. Scaffold the repository

- [x] 1.1 Run `paseo plugin init ~/projects/paseo-drafts`, then set the manifest to `{ "id": "paseo-drafts", "requirements": { "paseo": ">=0.8.0" } }`, pin `@getpaseo/plugin` to `0.8.0`, set the package name, description, MIT license and `test` script, add `LICENSE`, `.gitignore`, and `git init`; verify `npm install`, `npm run typecheck`, and `node --test` all exit 0 on the untouched scaffold
- [x] 1.2 Replace the greeting scaffold with the module skeleton (`shared/records.ts`, `shared/rpc.ts`, `shared/settings.ts`, `server/{paths,storage,search,send,index}.ts`, `client/{model,save-loop,checkpoint,web,i18n,queries}.ts`, `client/ui/`, `client/{editor,send-modal,plan-modal,snapshot-modal,drafts-surface,scratchpad-panel,settings-screen}.tsx`) as compiling stubs, and verify `npm run typecheck` passes and no file in the plugin root is outside the SDK's allowed set

## 2. Shared contracts

- [x] 2.1 Port `protocol/src/draft/types.ts` into `shared/records.ts` unchanged, and verify a `node --test` case parses a fixture `artifact.json`, `snapshots/0001.json`, and `dispatches.jsonl` line copied from the core test fixtures
- [x] 2.2 Define the eleven RPC contracts in `shared/rpc.ts` with `defineRpc` (`drafts.list`, `drafts.get`, `drafts.upsert`, `drafts.set_planned`, `drafts.set_archived`, `drafts.get_snapshot`, `drafts.send`, `drafts.search`, `drafts.discard`, plus `drafts.get_config` and `drafts.set_config` for the storage directory), keeping core's response shapes including `conflict` on upsert and a failed dispatch as a normal send response, and verify `npm run typecheck` passes
- [x] 2.3 Define `preferences` in `shared/settings.ts` with `defineSettings` (`language: "auto" | "en" | "zh-CN"` defaulting to `auto`; the directory is server-side config, see design decision 4), and verify a `node --test` case shows `{}` parses to the defaults

## 3. Server

- [x] 3.1 Port `draft-storage.ts` and `draft-model.ts` into `server/storage.ts` and `server/model.ts`, and translate `draft-storage.test.ts` to `node:test`; verify create, update with stale `baseVersion` conflict, setPlanned, setArchived, captureSnapshot idempotency, recordDispatch append, read-back after re-open, and unreadable-directory rejection all pass
- [x] 3.2 Implement `server/paths.ts` (XDG, `~/.config`, absolute override, empty string means default), and verify unit tests cover all four resolutions
- [x] 3.3 Port the search branch of `draft-session.ts` into `server/search.ts`, and verify tests show a body hit, a snapshot hit with `rev` and excerpt, archived flagging, limit, and no match
- [x] 3.4 Implement `server/send.ts` against an injected delivery interface (`resolveWorkspaceDirectory`, `createAgent`, `sendToAgent`), and verify tests show: new agent → snapshot captured, dispatch `sent` with agent id and correlation id; existing agent → `sent`; delivery throws → dispatch `failed` with the message and the snapshot kept; second send of the same revision reuses the snapshot; unknown draft throws
- [x] 3.5 Wire `index.server.ts`: `registerSettings(preferences)`, one store per resolved directory that is replaced when the config directory changes, eleven handlers mapping storage errors to messages that name the directory, the `PaseoApi`-backed delivery adapter, and an async cleanup that flushes; verify `npm run typecheck` passes and a `node --test` case using a fake `PluginServerContext` asserts eleven handlers and one settings registration

## 4. Client logic

- [x] 4.1 Port `model.ts` into `client/model.ts` with its tests translated, and verify `dispatchesInto`, `isPlannedFor`, `selectWorkspaceDraftSections`, `isDiscardableDraft`, and `draftDisplayTitle` cases pass
- [x] 4.2 Port `save-loop.ts` and `send-revision.ts` into `client/save-loop.ts` with the core tests translated, and verify the debounced write, failed write staying queued, conflict state, flush as a barrier, checkpoint recovery on start, and refusal of a send while `unsaved` or `conflict` all pass
- [x] 4.3 Port `checkpoint.ts` into `client/checkpoint.ts` and write `client/web.ts` (IndexedDB storage gated on `Platform.OS === "web"`, in-memory no-op otherwise, no top-level browser access); verify the store tests pass against a memory storage and `npm run typecheck` passes without the DOM lib
- [x] 4.4 Write `client/i18n.ts` with the `en` and `zh-CN` dictionaries copied verbatim from `packages/app/src/i18n/resources/drafts.ts` plus the plugin's own keys, `resolveLanguage`, and `format`; verify tests show `auto` + `zh-CN` locale → Chinese, `auto` + `en-US` → English, an explicit value winning, and `{{name}}` interpolation
- [x] 4.5 Write `client/queries.ts`: query keys, `useDraftList`, `useDraftDetail`, `useSnapshot`, `useDraftSearch`, and mutation hooks with 15-second polling, refetch on focus, and invalidation on success; verify `npm run typecheck` passes

## 5. Client UI

- [x] 5.1 Write `client/ui/` primitives (button, chip, status line, section header, row, empty state) styled only from `theme.colors` and `layout.compact`, and verify `npm run typecheck` passes
- [x] 5.2 Write `client/editor.tsx`: title and body inputs bound to the save loop, the four save states, the conflict bar with reload and overwrite, plan chips with remove and add, the lineage list, the send button, sent confirmation with open-agent navigation, and the send error line; verify `npm run typecheck` passes
- [x] 5.3 Write `client/send-modal.tsx`: provider chips from `providers.list`, a new-agent row per workspace and an existing-agent row per agent, planned tags, and the no-workspaces message; verify `npm run typecheck` passes
- [x] 5.4 Write `client/plan-modal.tsx` (workspaces and projects of the host, toggleable, project rows labelled) and `client/snapshot-modal.tsx` (loads the revision on open, loading, missing, immutable note, copy); verify `npm run typecheck` passes
- [x] 5.5 Write `client/drafts-surface.tsx`: search field, new draft, list rows with title, unsent and sent-count tags and revision match, archived group with count toggle, empty and no-match states, storage-unavailable and permission-error states, wide split and compact stacked layouts, and discard of an untouched draft on leave; verify `npm run typecheck` passes
- [x] 5.6 Write `client/scratchpad-panel.tsx`: planned and ran-here sections from `selectWorkspaceDraftSections`, new draft pre-planned for the workspace, in-place editor, "All drafts" through the captured `openSurface`, and the empty state; verify `npm run typecheck` passes
- [x] 5.7 Write `client/settings-screen.tsx` with the language select bound to `useSettings(preferences)` and the directory input with save and reset bound to `drafts.get_config` / `drafts.set_config`, showing the storage status, and verify `npm run typecheck` passes
- [x] 5.8 Write `index.client.tsx` registering the surface, sidebar item, workspace panel with both locations, settings screen, and the "New draft" Command Center items, returning a cleanup that removes all of them; verify `npm run typecheck` and `node --test` pass

## 6. QA on the dev daemon

- [x] 6.1 Set `pluginsEnabled: true` in `.dev/paseo-home/config.json`, start `npm run dev`, install with `env -u PASEO_AGENT_ID npm run cli -- plugin install ~/projects/paseo-drafts`, and verify `plugin ls` reports it running and `plugin logs paseo-drafts` shows no error
- [x] 6.2 In the web app on 8081, walk and screenshot: create and edit a draft, reload, and verify title, body, and "Saved" return; leave an untouched draft and verify it is not listed; verify the files under `~/.config/paseo/drafts/<id>/`
- [x] 6.3 Open the same draft in two browser tabs, edit in both, and verify the second reports changed elsewhere, reload keeps the other text, and overwrite lands the local text at the version shown
- [x] 6.4 Plan a draft for a workspace and for a project, open the Scratchpad panel in a workspace of that project while an agent runs, and verify both drafts appear under planned with the project one labelled, and that the panel is restored after a reload
- [x] 6.5 Send a revision to a new agent and the next revision to that session, and verify the agent receives the text, the confirmation opens it, the draft stays open, the history shows one row per revision, and the dispatch lines exist on disk; then edit and verify the draft returns to planned with unsent changes
- [x] 6.6 Send with an unavailable provider and verify the editor shows the reason and the history row reads failed while the snapshot file remains
- [x] 6.7 Search for a phrase that exists only in a sent revision and verify the match names the revision with an excerpt; search a phrase nothing contains and verify the no-match message
- [x] 6.8 Archive a draft, verify it leaves the list and every planned section and the archived count updates; unarchive and verify history and revisions survive
- [x] 6.9 Stop the dev daemon, type into a draft, reload the page, reopen the draft, and verify the text is there and reported not saved; start the daemon and verify it saves and the IndexedDB checkpoint is cleared
- [x] 6.10 Switch the language setting to Chinese, English, and automatic and verify the surface, panel, and settings screen re-render each time without a reload; point the directory setting at an unreadable path and verify the storage error names it, then restore the default
- [x] 6.11 Fix every defect found, re-run `npm run typecheck` and `node --test`, and `paseo plugin reload paseo-drafts` until 6.2 through 6.10 pass without a code change

## 7. Publish

- [x] 7.1 Write `README.md` (what it is, install command, the two-machine setup, storage location and layout, settings, the four sandbox differences from core, development commands) and verify every command in it runs as written
- [x] 7.2 Create the public repository `custyhs/paseo-drafts` with `gh repo create`, push `main`, tag and release `v0.1.0`; verify the tag is visible on GitHub
- [x] 7.3 Remove the directory install from the dev daemon, run `env -u PASEO_AGENT_ID npm run cli -- plugin add custyhs/paseo-drafts --ref v0.1.0`, and verify the Git-sourced install runs, the sidebar shows Drafts, and the drafts written in section 6 are still listed
- [x] 7.4 Commit this change's planning files on `latex-render` with the install command for the second machine recorded in the proposal, and verify `openspec validate pluginize-drafts --type change --strict` passes
