import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

/**
 * Drives the real store the way the launcher does. "Clicking Scratchpad does
 * nothing" was `openTab` returning null for a target the normalizer refused to
 * recognise, and no unit test, type check or lint run said a word about it.
 *
 * The persistence assertion covers the second half of the same defect: the
 * layout keeps its own hand-maintained Zod union, so a tab could open and still
 * be dropped on the way to storage.
 */

const workspaceKey = buildWorkspaceTabPersistenceKey({
  serverId: "srv_test",
  workspaceId: "wks_test",
}) as string;

async function flushPersist(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("opening a Scratchpad tab", () => {
  it("returns a tab id instead of refusing the target", () => {
    const store = createWorkspaceLayoutStore().getState();
    const tabId = store.openTab({
      workspaceKey,
      target: { kind: "scratchpad" },
      intent: "new",
    });
    expect(tabId).not.toBeNull();
  });

  it("puts the tab in the workspace where the panel can render it", () => {
    const store = createWorkspaceLayoutStore().getState();
    store.openTab({ workspaceKey, target: { kind: "scratchpad" }, intent: "new" });
    const tabs = store.getWorkspaceTabs(workspaceKey);
    expect(tabs.map((tab) => tab.target.kind)).toContain("scratchpad");
  });

  it("reuses one tab rather than stacking duplicates on reveal", () => {
    const store = createWorkspaceLayoutStore().getState();
    const first = store.openTab({ workspaceKey, target: { kind: "scratchpad" }, intent: "new" });
    const second = store.openTab({
      workspaceKey,
      target: { kind: "scratchpad" },
      intent: "reveal",
    });
    expect(second).toBe(first);
  });

  it("survives persistence, which is where the second copy of the schema lives", async () => {
    const store = createWorkspaceLayoutStore().getState();
    store.openTab({ workspaceKey, target: { kind: "scratchpad" }, intent: "new" });
    await flushPersist();

    const writes = vi.mocked(AsyncStorage.setItem).mock.calls;
    expect(writes.length).toBeGreaterThan(0);
    const blob = writes.at(-1)?.[1] ?? "";
    // A kind the storage union does not name is stripped here, silently.
    expect(blob).toContain("scratchpad");
  });
});
