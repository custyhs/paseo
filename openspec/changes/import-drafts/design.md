## Context

See proposal.md — Why. What shapes this design is that the code already exists and the decision is how to take it.

Measured state of the source branch (`fotile96/paseo` `feat/drafts`, head `6a990f412`, Apache 2.0):

- Merge base with this fork's `latex-render` is `d4841b68f` (2026-09-02): sixty commits behind this head, twenty-three ahead.
- A trial merge conflicts in exactly two files, both on import statements: `packages/server/src/server/session.ts` and `packages/app/src/workspace-tabs/launcher/index.tsx`.
- Every named import across its thirty-five new files resolves against this tree, and no imported symbol has disappeared.
- It touches no `package.json`, so there is no dependency or lockfile question to answer.
- Two of its twenty-three commits are unrelated to drafts (ZCode catalog, desktop web UI opt-in), and two are commits that chased upstream reshaping the launcher and the v0.5.1→v0.7.2 drift.

The constraint that outranks the rest is this fork's own: `latex-render` is rebased onto `upstream/main` periodically, and custom work should sit in new files behind extension points (`openspec/config.yaml`).

## Goals / Non-Goals

**Goals:**

- Land the behavior in specs/durable-drafts with the source branch's authorship intact and its reasoning readable.
- Keep `latex-render` linear, so the next rebase onto `upstream/main` is no harder than it is today.
- Close the two defects found in the source branch before the feature is relied on, each separately revertible.
- Verify against a running daemon and a real browser, not only against unit tests.

**Non-Goals:**

- Redesigning any part of the imported feature. Where its design and this fork's conventions disagree, the imported design wins unless it is wrong.
- Tracking the source branch. This is a one-time import; no remote is added and no future merges from it are planned.
- Reducing the standing rebase surface below what the imported design already achieves.

## Decisions

### Import by cherry-pick, not by merge, squash, or rewrite

Cherry-picking the twenty-three commits onto a branch off `latex-render` keeps original authorship, keeps history linear, and keeps each commit reviewable and bisectable.

- **Merge commit** — rejected. Rebasing a history containing a merge commit onto `upstream/main` is the one operation this fork performs regularly and the one a merge commit makes painful.
- **Squash to one commit** — rejected. Twenty-three commits include the reasoning for each fix-up; four of them exist because upstream moved underneath the branch. Collapsing them discards exactly the context a future rebase needs.
- **Reimplement from the design** — rejected. Weeks of work to arrive at something less complete, when the measured cost of importing is two mechanical conflicts.

### Take all twenty-three commits, including the two unrelated ones

The ZCode catalog entry and the desktop web UI opt-in are independent of drafts, and each is covered by its own delta spec so nothing lands unspecified. Taking them keeps the cherry-pick range contiguous: skipping commits in the middle of a range means every later commit replays against a tree the author never saw. The desktop fix is directly useful here, since this fork builds its own desktop app locally.

### Keep the source branch's naming: "Drafts" in the product, `artifact` in the code

The source branch already solved the collision this fork was going to have to solve. `docs/glossary.md` spends "draft" on the composer's draft agent tab, `DraftAgentControls`, and review drafts; the branch therefore names the record an `artifact` in code while the product surface says "Drafts". Renaming the code to `scratchpad` was considered and rejected: it would touch all thirty-five new files, diverge from the comments that explain the design, and buy nothing the existing split does not already buy.

The mitigation is a glossary entry that separates the three senses of "draft" now present, following the shape of the existing `Conflict` entry, which documents two senses rather than pretending there is one.

### Resolve the two conflicts by adapting to upstream, never by reverting upstream

- `server/session.ts` — upstream restructured the dispatch chain into `dispatchWorkspaceLifecycleMessage`. The draft domain enters as one entry in the current chain. `dispatchInboundMessage` must not gain a branch: it sits exactly on the lint complexity ceiling, so a twenty-first branch fails the build. This is the reason the source branch routes drafts through a combined method rather than a `case` of its own, and that shape is preserved against whatever the chain looks like now.
- `app/workspace-tabs/launcher/index.tsx` — upstream constrained the launch-item table with `satisfies Record<BuiltInLaunchItemId, NewTabSelection>`. The `scratchpad` item is registered in `BuiltInLaunchItemId` and added to the table, rather than loosening the constraint.

### Treat the seven auto-merged app registration files as unverified

`sidebar-nav/model.ts`, `workspace-tabs/model.ts`, `panels/panel-manifest.ts`, `stores/workspace-layout-store.ts`, `utils/host-routes.ts`, `app/_layout.tsx`, and `settings/appearance/sidebar-nav-section.tsx` merged without conflict, which says the text still applies, not that the registration contracts still mean the same thing. Upstream reshaped nav and launcher registration twice inside the sixty-commit window. Each is read against current upstream before the feature is exercised, and the nav row, route, tab kind, and panel are then confirmed in a real browser rather than inferred from a green typecheck.

### Close the send gap by flushing, and refuse rather than send stale text

The editor's send path calls the source directly while the save loop still holds a debounced or in-flight edit, so sending inside the 200 ms window captures the daemon's older body into an immutable snapshot — the one record in this feature that cannot be corrected afterwards. Send therefore awaits the save loop's flush and proceeds only once the host has accepted the text; a flush that fails surfaces as the send failing, with its reason.

Capturing the snapshot client-side from the editor's live text was considered and rejected: the daemon owns the version counter, and a snapshot captured from text the daemon never accepted would not correspond to any version.

### Close the offline gap by replaying the checkpoint into the editor

Checkpoints are written and cleared today, and never read: nothing restores `@paseo:draft-checkpoints` into the editor or the write queue. Unsaved text survives a disconnect within a session through the source's in-memory overlay, and dies on restart. On opening a draft, a checkpoint for it is restored into the editor and queued, and the state stays "not saved" until the host accepts it — the checkpoint's `baseVersion` becomes the retry's base, so a draft changed elsewhere meanwhile surfaces as a conflict through the path that already exists.

The alternative of restoring silently in the background was rejected: text that reappears without being shown is indistinguishable from text that was lost.

### Documentation lands in the doc that owns each subject

No new "drafts" doc that repeats the code. The glossary gains the three senses of "draft"; `docs/data-model.md` gains the daemon storage layout and the client checkpoint key alongside the other stores it already documents; `docs/architecture.md` gains the `draft.*` domain where it describes the WebSocket protocol. ZCode setup notes arrive with the source branch in `docs/custom-providers.md`, which is where provider configuration already lives.

## Risks / Trade-offs

- **Semantic drift in the seven auto-merged registration files** → Read each against current upstream, and prove the nav row, `/drafts` route, `scratchpad` tab kind, and panel work in a real browser before the change is considered done.
- **`server/session.ts` is the most-edited file in the server (353 changes in half a year)** → The imported design already limits the exposure to an import, a field, a constructor line, and one chain entry, with no `case`. Keep it that way; do not expand the footprint while resolving the conflict.
- **The lint complexity ceiling in `dispatchInboundMessage`** → A branch added there fails the build rather than degrading quietly, so the failure is loud. Route through the existing chain instead.
- **Regenerated inbound validators** → `packages/protocol` changes mean zod-aot regenerates, and its compiler carries local patches. Run the protocol validation tests, not just typecheck.
- **Snapshots accumulate without a retention policy** → Every send writes an immutable snapshot file and never removes one. Acceptable for personal use at this volume; revisit if a drafts directory becomes large.
- **`draft.*` reuses `daemon.read` and `daemon.manage` rather than adding a semantic permission** → Drafts are consequently readable by anything holding host read. Adding a dedicated permission would diverge from the imported code and from upstream's permission set; recorded rather than changed.
- **Untranslated locales reuse English** → Nine locale files gain the same keys, and only English and Simplified Chinese carry real translations. A legible English label beats a blank row.

## Migration Plan

No data migration. Draft storage is a new directory under `$PASEO_HOME`, and a daemon that cannot open it starts anyway and stops advertising the capability, so a partial rollout degrades to "this host does not support drafts" rather than to a broken daemon.

Work happens on a branch off `latex-render` and merges back only after the verification steps in tasks.md pass. Rollback is reverting the range; the `drafts/` directory left behind on disk is inert, and no upstream behavior depends on it.

## Open Questions

- `PlannedTarget` carries a `projectKey` that nothing reads, reserved for a future cross-host mapping. Keep it as imported for now; whether it earns its place is answerable once multi-host use is real.
- Whether captured revisions need a retention policy, and if so whether by count or by age. Deferrable: the behavior in specs/durable-drafts does not depend on the answer.
