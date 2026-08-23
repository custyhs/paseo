import { describe, expect, test } from "vitest";
import { DraftCheckpointStore, type CheckpointStorage } from "./checkpoint";
import { MockDraftsSource } from "./mock-source";
import type { ArtifactDetail } from "./model";
import { createDraftSaveLoop, type DraftSaveState } from "./save-loop";
import type { DraftListQuery, DraftsSource, SendResult, SendTarget } from "./source";

/**
 * Saving when the daemon is not there. The brief singles this failure out:
 * a crash, a navigation or a temporary disconnection must not casually lose
 * hours of work. ADR-0004 is the design; these are its teeth.
 *
 * These exercise the real loop rather than a transcription of it, so the loop
 * cannot drift out from under them.
 */

/** In-memory storage, and it survives being handed to a second store. */
function fakeStorage(): CheckpointStorage & { dump: () => Record<string, string> } {
  const items = new Map<string, string>();
  return {
    getItem: (key) => Promise.resolve(items.get(key) ?? null),
    setItem: (key, value) => {
      items.set(key, value);
      return Promise.resolve();
    },
    dump: () => Object.fromEntries(items),
  };
}

/** A source whose writes fail, standing in for a daemon that is not there. */
class UnreachableDaemon implements DraftsSource {
  reachable = false;
  readonly attempts: string[] = [];
  constructor(readonly inner: MockDraftsSource) {}

  list(query?: DraftListQuery) {
    return this.inner.list(query);
  }
  get(artifactId: string) {
    return this.inner.get(artifactId);
  }
  create(input?: { planned?: ArtifactDetail["planned"] }) {
    return this.inner.create(input);
  }
  update(input: { artifactId: string; baseVersion: number; body?: string }) {
    this.attempts.push(input.body ?? "");
    if (!this.reachable) return Promise.reject(new Error("daemon unreachable"));
    return this.inner.update(input);
  }
  setPlanned(input: { artifactId: string; planned: ArtifactDetail["planned"] }) {
    return this.inner.setPlanned(input);
  }
  setArchived(input: { artifactId: string; archived: boolean }) {
    return this.inner.setArchived(input);
  }
  discard(artifactId: string) {
    return this.inner.discard(artifactId);
  }
  send(input: { artifactId: string; target: SendTarget }): Promise<SendResult> {
    return this.inner.send(input);
  }
  subscribe(listener: () => void) {
    return this.inner.subscribe(listener);
  }
}

async function harness(options: { storage?: CheckpointStorage } = {}) {
  const storage = options.storage ?? fakeStorage();
  const inner = new MockDraftsSource();
  const source = new UnreachableDaemon(inner);
  const checkpoints = new DraftCheckpointStore(storage);
  await checkpoints.load();
  const created = await inner.create();
  const states: DraftSaveState[] = [];
  const loop = createDraftSaveLoop({
    source,
    checkpoints,
    serverId: "host-1",
    artifactId: created.id,
    version: created.version,
    onState: (state) => states.push(state),
    // The debounce is pinned by autosave.test.ts; here it is only in the way.
    debounceMs: 0,
    now: () => 1_000,
  });
  return { storage, inner, source, checkpoints, created, states, loop };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("saving while the daemon is unreachable", () => {
  test("the text stays queued, so there is something left to retry", async () => {
    const { loop, source } = await harness();

    loop.onChangeText("an hour of thinking");
    await loop.flush();

    expect(source.attempts).toEqual(["an hour of thinking"]);
    expect(loop.hasPendingText()).toBe(true);
  });

  test("the editor never claims to have saved what only this machine has", async () => {
    const { loop, states } = await harness();

    loop.onChangeText("an hour of thinking");
    await loop.flush();

    expect(states.at(-1)).toEqual({ status: "unsaved" });
    expect(states).not.toContainEqual({ status: "saved" });
  });

  test("the text is checkpointed locally, and a restart finds it", async () => {
    const storage = fakeStorage();
    const { loop, created } = await harness({ storage });

    loop.onChangeText("an hour of thinking");
    await loop.flush();
    await settle();

    // A different store over the same storage is what a restart looks like.
    const afterRestart = new DraftCheckpointStore(storage);
    await afterRestart.load();
    expect(afterRestart.get("host-1", created.id)?.body).toBe("an hour of thinking");
  });

  test("reconnecting is just a long delay: the next flush persists it", async () => {
    const { loop, source, inner, created, states } = await harness();

    loop.onChangeText("an hour of thinking");
    await loop.flush();

    source.reachable = true;
    await loop.flush();

    expect((await inner.get(created.id))?.body).toBe("an hour of thinking");
    expect(loop.hasPendingText()).toBe(false);
    expect(states.at(-1)).toEqual({ status: "saved" });
  });

  test("the checkpoint is dropped only once the daemon has the text", async () => {
    const { loop, source, checkpoints, created } = await harness();

    loop.onChangeText("an hour of thinking");
    await loop.flush();
    await settle();
    expect(checkpoints.get("host-1", created.id)).toBeDefined();

    source.reachable = true;
    await loop.flush();
    await settle();
    expect(checkpoints.get("host-1", created.id)).toBeUndefined();
  });

  test("keystrokes during a failed write are not lost either", async () => {
    const { loop, source, inner, created } = await harness();

    loop.onChangeText("first");
    await loop.flush();
    loop.onChangeText("first and second");
    await loop.flush();

    source.reachable = true;
    await loop.flush();

    expect((await inner.get(created.id))?.body).toBe("first and second");
  });
});

describe("a draft changed by another client", () => {
  async function conflicted() {
    const context = await harness();
    context.source.reachable = true;
    // Another client writes, so our base version goes stale.
    await context.inner.update({
      artifactId: context.created.id,
      baseVersion: context.created.version,
      body: "written elsewhere",
    });
    return context;
  }

  test("the conflict is surfaced with the record as it now stands", async () => {
    const { loop, states } = await conflicted();

    loop.onChangeText("written here");
    await loop.flush();

    const last = states.at(-1);
    expect(last?.status).toBe("conflict");
    expect(last?.status === "conflict" && last.remote.body).toBe("written elsewhere");
  });

  test("reload drops ours and clears the checkpoint", async () => {
    const { loop, states, checkpoints, created, inner } = await conflicted();

    loop.onChangeText("written here");
    await loop.flush();
    const conflict = states.at(-1);
    if (conflict?.status !== "conflict") throw new Error("expected a conflict");

    await loop.reload(conflict.remote);
    await settle();

    expect(loop.hasPendingText()).toBe(false);
    expect(checkpoints.get("host-1", created.id)).toBeUndefined();
    expect((await inner.get(created.id))?.body).toBe("written elsewhere");
  });

  test("overwrite is a retry against the version we were shown", async () => {
    const { loop, states, inner, created, source } = await conflicted();

    loop.onChangeText("written here");
    await loop.flush();
    const conflict = states.at(-1);
    if (conflict?.status !== "conflict") throw new Error("expected a conflict");

    const before = source.attempts.length;
    await loop.overwrite(conflict.remote);

    expect((await inner.get(created.id))?.body).toBe("written here");
    // One more `update`, no second RPC and no force flag (ADR-0002 decision 4).
    expect(source.attempts).toHaveLength(before + 1);
    expect(states.at(-1)).toEqual({ status: "saved" });
  });
});
