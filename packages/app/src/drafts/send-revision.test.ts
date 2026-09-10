import { describe, expect, test } from "vitest";
import { DraftCheckpointStore, type CheckpointStorage } from "./checkpoint";
import { MockDraftsSource } from "./mock-source";
import type { ArtifactDetail } from "./model";
import { createDraftSaveLoop } from "./save-loop";
import { DraftSendBlockedError, sendRevision } from "./send-revision";
import type { DraftListQuery, DraftsSource, SendResult, SendTarget } from "./source";

/**
 * What the daemon freezes into a snapshot is whatever body it holds, and a
 * snapshot is the one record here that cannot be corrected afterwards. So a
 * send has to get the typed text to the daemon first, and refuse rather than
 * capture text nobody has accepted.
 */

function fakeStorage(): CheckpointStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => Promise.resolve(items.get(key) ?? null),
    setItem: (key, value) => {
      items.set(key, value);
      return Promise.resolve();
    },
  };
}

/** A daemon that can be made unreachable, or slow enough to still be writing. */
class ControlledDaemon implements DraftsSource {
  reachable = true;
  /** Resolve this to let a write in flight complete. */
  gate: (() => void) | null = null;

  constructor(readonly inner: MockDraftsSource) {}

  list(query?: DraftListQuery) {
    return this.inner.list(query);
  }
  get(artifactId: string) {
    return this.inner.get(artifactId);
  }
  getSnapshot(input: { artifactId: string; rev: number }) {
    return this.inner.getSnapshot(input);
  }
  search(input: { query: string; limit?: number }) {
    return this.inner.search(input);
  }
  create(input?: { planned?: ArtifactDetail["planned"] }) {
    return this.inner.create(input);
  }
  async update(input: { artifactId: string; baseVersion: number; body?: string }) {
    if (!this.reachable) throw new Error("daemon unreachable");
    if (this.gate) {
      await new Promise<void>((resolve) => {
        this.gate = resolve;
      });
    }
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

const target: SendTarget = { kind: "new_agent", workspaceId: "ws_main", provider: "claude" };

async function harness() {
  const inner = new MockDraftsSource();
  const source = new ControlledDaemon(inner);
  const checkpoints = new DraftCheckpointStore(fakeStorage());
  await checkpoints.load();
  const created = await inner.create();
  const loop = createDraftSaveLoop({
    source,
    checkpoints,
    serverId: "host-1",
    artifactId: created.id,
    version: created.version,
    onState: () => {},
    // Long enough that nothing here reaches the daemon by debounce alone.
    debounceMs: 10_000,
  });
  return { inner, source, checkpoints, created, loop };
}

async function detail(source: MockDraftsSource, id: string): Promise<ArtifactDetail> {
  const artifact = await source.get(id);
  if (!artifact) throw new Error(`missing ${id}`);
  return artifact;
}

describe("sending a revision", () => {
  test("text typed inside the debounce window is what gets captured", async () => {
    const { inner, created, loop } = await harness();
    loop.onChangeText("send exactly this");

    await sendRevision({ loop, source: inner, artifactId: created.id, target });

    const artifact = await detail(inner, created.id);
    expect(artifact.snapshots.map((snapshot) => snapshot.body)).toEqual(["send exactly this"]);
  });

  test("a write already on the wire is waited for, not raced", async () => {
    const { inner, source, created, loop } = await harness();
    loop.onChangeText("first");
    // Park the write so it is still in flight when the send starts.
    source.gate = () => {};
    const writing = loop.flush();
    const sending = sendRevision({ loop, source: inner, artifactId: created.id, target });
    source.gate?.();
    source.gate = null;
    await writing;
    await sending;

    const artifact = await detail(inner, created.id);
    expect(artifact.snapshots.map((snapshot) => snapshot.body)).toEqual(["first"]);
  });

  test("a send the daemon has not accepted the text for is refused", async () => {
    const { inner, source, created, loop } = await harness();
    source.reachable = false;
    loop.onChangeText("never reached the daemon");

    await expect(
      sendRevision({ loop, source: inner, artifactId: created.id, target }),
    ).rejects.toBeInstanceOf(DraftSendBlockedError);
  });

  test("a refused send captures no revision and logs no dispatch", async () => {
    const { inner, source, created, loop } = await harness();
    source.reachable = false;
    loop.onChangeText("never reached the daemon");

    await sendRevision({ loop, source: inner, artifactId: created.id, target }).catch(() => {});

    const artifact = await detail(inner, created.id);
    expect(artifact.snapshots).toEqual([]);
    expect(artifact.dispatches).toEqual([]);
  });

  test("the send carries the version the daemon settled on", async () => {
    const { inner, created, loop } = await harness();
    loop.onChangeText("one");
    await sendRevision({ loop, source: inner, artifactId: created.id, target });
    loop.onChangeText("two");
    await sendRevision({ loop, source: inner, artifactId: created.id, target });

    const artifact = await detail(inner, created.id);
    // Two distinct revisions, in order, neither rewritten by the other.
    expect(artifact.snapshots.map((snapshot) => snapshot.body)).toEqual(["one", "two"]);
    expect(artifact.dispatches).toHaveLength(2);
  });
});
