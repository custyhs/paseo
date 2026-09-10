## 1. Prepare the import

- [x] 1.1 Fetch the source branch into a local ref without adding a remote (`git fetch https://github.com/fotile96/paseo feat/drafts:refs/heads/import/fork-drafts`) and verify its head is `6a990f412` and its merge base with `latex-render` is `d4841b68f`
- [x] 1.2 Create the working branch (`git switch -c import-drafts latex-render`) and verify the tree is clean and `git log -1` is `6404b9179`

## 2. Cherry-pick the twenty-three commits

The single trial merge conflicted in two files, but a sequential cherry-pick replays each patch against an evolving tree, so conflicts can surface in commits this prediction does not name — `messages.ts`, `daemon-client.ts`, the i18n locales, and the nav registration files are the likely extras. Resolve every conflict by adapting the imported change to current upstream, never by reverting upstream. If a mid-range commit becomes genuinely unresolvable on its own, stop and squash the remaining range rather than forcing it.

- [x] 2.1 Pick `bf582e4f1 c00e80644 0f668b724 86eb02153 5cb16585f 75f9e8670 06018b39e d2c5b0770 de59660ac 657bae257` in that order and verify each lands and `git status` is clean after the range
- [x] 2.2 Pick `7ae684c87` and resolve the `packages/server/src/server/session.ts` conflict by entering the draft domain as one entry in upstream's current dispatch chain, verifying that `dispatchInboundMessage` gains no branch and that `npm run lint -- packages/server/src/server/session.ts` passes
- [x] 2.3 Pick `884e813c3 ef18f57e7 78f5b897e` and verify each lands cleanly
- [x] 2.4 Pick `8b9890dc2` and resolve the `packages/app/src/workspace-tabs/launcher/index.tsx` conflict by registering `scratchpad` in `BuiltInLaunchItemId` and adding its table entry, without loosening the `satisfies Record<...>` constraint
- [x] 2.5 Pick `aa4ba726d 870089ae8 86168227d 3b0c0a6c3 d6f7d7bd2 b5facb4ef` and verify each lands
- [x] 2.6 Pick `a6dd123d9 6a990f412`, resolving any further launcher conflict the same way, and verify `git diff import/fork-drafts --stat -- packages/app/src/drafts packages/server/src/server/drafts packages/protocol/src/draft` reports no differences in the purely new directories

## 3. Make the build honest

- [x] 3.1 Run `npm run build:client` then `npm run build:server` and verify both succeed, so cross-package declarations and the regenerated zod-aot validators are current before anything is diagnosed
- [x] 3.2 Run `npm run typecheck` and fix real breakage only — do not add local duplicate types or annotate inferred callback parameters to silence a stale declaration
- [x] 3.3 Run `npm run lint` and verify it passes, including the complexity ceiling in `packages/server/src/server/session.ts`
- [x] 3.4 Run `npm run format` and verify `npm run format:check` is clean

## 4. Run the narrow tests the import brings

Each of these is a single file: `npx vitest run <file> --bail=1`. Never run a workspace suite.

- [x] 4.1 Run `packages/protocol/src/messages.drafts.test.ts` and `packages/protocol/tests/validation/ws-outbound.test.ts` and verify both pass, proving the new schemas compile through the patched zod-aot path
- [x] 4.2 Run `packages/server/src/server/drafts/draft-storage.test.ts` and `packages/server/src/server/session/draft/draft-session.test.ts` and verify both pass
- [x] 4.3 Run each of `packages/app/src/drafts/{autosave,model,offline,send,daemon-source,tab-integration,tab-open}.test.ts` and verify all seven pass
- [ ] 4.4 Run the four touched upstream tests — `packages/app/src/sidebar-nav/model.test.ts`, `packages/app/src/workspace-tabs/launcher/internal/catalog.test.ts`, `packages/app/src/hooks/use-acp-provider-catalog.test.ts`, `packages/desktop/src/daemon/daemon-manager.test.ts` — and verify all pass

## 5. Read the auto-merged registration files against current upstream

A clean auto-merge says the text still applies, not that the contract still means the same thing. Upstream reshaped nav and launcher registration twice inside the sixty-commit window.

- [x] 5.1 Read `packages/app/src/sidebar-nav/model.ts`, `packages/app/src/components/sidebar/sidebar-nav-rows.tsx`, and `packages/app/src/screens/settings/appearance/sidebar-nav-section.tsx` against upstream's current nav registration and verify the Drafts row is registered, orderable, and hideable the way every other row is
- [ ] 5.2 Read `packages/app/src/workspace-tabs/{identity,model}.ts`, `packages/app/src/panels/{panel-manifest,register-panels}.ts`, and `packages/app/src/stores/workspace-layout-store.ts` and verify the `scratchpad` tab kind and panel are registered and persisted through the same contracts the other panels use
- [x] 5.3 Read `packages/app/src/app/_layout.tsx` and `packages/app/src/utils/host-routes.ts` against `docs/expo-router.md` and verify the `/drafts` route is owned the way the other screen routes are, with no effect on startup restore or active-workspace selection

## 6. Prove it in the real app

Run the dev daemon (`npm run dev`, port 6768) and the app (`npm run dev:app`, port 8081), and drive it with the Paseo browser tools. When using the dev CLI from inside an agent, strip `PASEO_AGENT_ID` from the environment first.

- [x] 6.1 Create a draft, type a title and body, reload the browser, and verify both come back and the editor reports "Saved"
- [x] 6.2 Open the Scratchpad panel in a workspace while an agent is running, verify the draft appears under "Planned here", reload, and verify the panel is restored in the same workspace
- [x] 6.3 Send a revision to a new agent and the next revision to an existing session, and verify the session receives the text, the draft stays open, and each history row shows the revision it sent
- [x] 6.4 Edit a sent draft and verify it returns to "Planned here" marked as having unsent changes, then open the earlier revision and verify it still shows the text as sent
- [x] 6.5 Archive a draft, verify it leaves the list and the archived group reports its count, unarchive it, and verify its history survived
- [x] 6.6 Search for a phrase that exists only in a sent revision and verify the draft matches and names the revision it was found in
- [x] 6.7 Point the app at a daemon without drafts support and verify the surface says the host does not support drafts, with no degraded local mode
- [x] 6.8 Run `packages/app/e2e/browser/drafts.spec.ts` and verify it passes

## 7. Close the two defects, test first

- [x] 7.1 Write a failing test proving a send inside the autosave debounce window captures the typed text, then make send await the save loop's flush, and verify the test passes
- [x] 7.2 Write a failing test proving a send is refused with its reason when the pending write cannot be accepted, then implement the refusal, and verify no revision is captured
- [x] 7.3 Write a failing test proving a checkpoint written before a restart is restored into the editor and queued on reopen, then implement the restore, and verify the state reads "Not saved" until the host accepts it
- [x] 7.4 Write a failing test proving draft storage that cannot be read for any reason other than absence fails to initialize, then make it reject so the host stops advertising the capability, and verify a host with unusable storage reports "does not support drafts" instead of an empty list
- [x] 7.5 Verify in the real app: with the daemon stopped, type into a draft, restart the client, reopen the draft, and confirm the text is visible and marked not saved, then start the daemon and confirm it saves

## 8. Write the documentation the import owes

- [x] 8.1 Add a `docs/glossary.md` entry separating the three senses of "draft" — draft agent, the composer's draft store, and the draft artifact — following the shape of the existing `Conflict` entry, and verify no other doc now contradicts it
- [x] 8.2 Add the daemon storage layout and the `@paseo:draft-checkpoints` client key to `docs/data-model.md` alongside the stores it already documents, integrated into the relevant sections rather than appended
- [x] 8.3 Add the `draft.*` domain to the WebSocket protocol section of `docs/architecture.md`, and verify no new doc duplicates what these two now own

## 9. Land it

- [x] 9.1 Re-run `npm run typecheck`, `npm run lint`, `npm run format:check`, and the task 4 test files, and verify all are green after the gap fixes and doc changes
- [ ] 9.2 Merge `import-drafts` into `latex-render` as a fast-forward and verify `git log --graph --oneline -25` shows linear history with no merge commit
- [ ] 9.3 Push `latex-render` to `origin` and verify the push succeeds
- [ ] 9.4 Update `openspec/specs/` from this change's delta specs and archive the change, confirming the shipped behavior matches what the specs claim
