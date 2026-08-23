import { describe, expect, it } from "vitest";
import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
} from "@/workspace-tabs/identity";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

/**
 * The scratchpad tab could not be opened at all, and reading the code missed why
 * twice. A new tab kind has to be named in several places that enumerate the
 * existing ones, and none of them fail to compile when it is not:
 *
 * - `normalizeWorkspaceTabTarget` drops any kind its switch does not name, and
 *   `openTab` treats a null target as a refusal — so the click did nothing.
 * - the persisted layout keeps a second, hand-maintained Zod union, so a tab
 *   that opened was discarded again on the way to storage.
 *
 * The side panel whitelist is the third such place; it is private, so
 * `design/drift-check.sh` greps it rather than exporting a symbol for tests.
 *
 * These pin the contract from the outside: whatever the internals look like, a
 * scratchpad target has to survive normalization, keep a stable identity, and be
 * accepted by the side panel.
 */

const SCRATCHPAD: WorkspaceTabTarget = { kind: "scratchpad" };

describe("scratchpad tab target", () => {
  it("survives normalization instead of being dropped", () => {
    // openTab bails on a null target, which is exactly what "clicking does
    // nothing" looked like.
    expect(normalizeWorkspaceTabTarget(SCRATCHPAD)).toEqual(SCRATCHPAD);
  });

  it("normalizes the same way the other simple kinds do", () => {
    for (const kind of ["files", "pull_request", "scratchpad"] as const) {
      expect(normalizeWorkspaceTabTarget({ kind } as WorkspaceTabTarget)).toEqual({ kind });
    }
  });

  it("has a stable identity so reopening reuses one tab", () => {
    const first = buildDeterministicWorkspaceTabId(SCRATCHPAD);
    const second = buildDeterministicWorkspaceTabId(SCRATCHPAD);
    expect(first).toBe(second);
    expect(first).not.toBe(buildDeterministicWorkspaceTabId({ kind: "files" }));
  });
});
