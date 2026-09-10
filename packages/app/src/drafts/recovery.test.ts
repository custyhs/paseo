import { describe, expect, test } from "vitest";
import {
  DraftCheckpointStore,
  recoveredDraftValues,
  type CheckpointStorage,
  type DraftCheckpoint,
} from "./checkpoint";
import { MockDraftsSource } from "./mock-source";
import { createDraftSaveLoop, type DraftSaveState } from "./save-loop";

/**
 * A checkpoint that is written and never read back is not a safety net. These
 * cover the other half of ADR-0004: what the editor shows when it reopens a
 * draft whose last keystrokes never reached the daemon, and what happens to
 * them afterwards.
 */

function fakeStorage(seed?: Record<string, string>): CheckpointStorage & {
  dump: () => Record<string, string>;
} {
  const items = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (key) => Promise.resolve(items.get(key) ?? null),
    setItem: (key, value) => {
      items.set(key, value);
      return Promise.resolve();
    },
    dump: () => Object.fromEntries(items),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("what the editor shows for recovered text", () => {
  const artifact = { title: "on the daemon", body: "accepted body" };

  test("the checkpointed body wins over the one the daemon holds", () => {
    const checkpoint: DraftCheckpoint = {
      serverId: "host-1",
      artifactId: "drf_1",
      body: "typed while offline",
      baseVersion: 3,
      updatedAt: 1,
    };
    expect(recoveredDraftValues({ artifact, checkpoint })).toEqual({
      title: "on the daemon",
      body: "typed while offline",
    });
  });

  test("a title-only checkpoint leaves the body alone", () => {
    const checkpoint: DraftCheckpoint = {
      serverId: "host-1",
      artifactId: "drf_1",
      title: "typed while offline",
      baseVersion: 3,
      updatedAt: 1,
    };
    expect(recoveredDraftValues({ artifact, checkpoint })).toEqual({
      title: "typed while offline",
      body: "accepted body",
    });
  });

  test("a cleared title recovers as no title, not as the daemon's old one", () => {
    const checkpoint: DraftCheckpoint = {
      serverId: "host-1",
      artifactId: "drf_1",
      title: null,
      baseVersion: 3,
      updatedAt: 1,
    };
    expect(recoveredDraftValues({ artifact, checkpoint })).toEqual({
      title: "",
      body: "accepted body",
    });
  });

  test("no checkpoint means what the daemon holds", () => {
    expect(recoveredDraftValues({ artifact, checkpoint: undefined })).toEqual({
      title: "on the daemon",
      body: "accepted body",
    });
  });
});

describe("a draft reopened with text the daemon never got", () => {
  async function reopened(input: { staleBaseVersion?: boolean } = {}) {
    const source = new MockDraftsSource();
    const created = await source.create();
    // The daemon has accepted one write; the checkpoint was typed against it.
    const accepted = await source.update({
      artifactId: created.id,
      baseVersion: created.version,
      body: "accepted body",
    });
    if (input.staleBaseVersion) {
      // Someone else wrote after this client went away.
      await source.update({
        artifactId: created.id,
        baseVersion: accepted.version,
        body: "written elsewhere",
      });
    }

    const checkpoint: DraftCheckpoint = {
      serverId: "host-1",
      artifactId: created.id,
      body: "typed while offline",
      baseVersion: accepted.version,
      updatedAt: 1,
    };
    const storage = fakeStorage({
      "@paseo:draft-checkpoints": JSON.stringify({ version: 1, checkpoints: [checkpoint] }),
    });
    const checkpoints = new DraftCheckpointStore(storage);
    await checkpoints.load();

    const states: DraftSaveState[] = [];
    const loop = createDraftSaveLoop({
      source,
      checkpoints,
      serverId: "host-1",
      artifactId: created.id,
      // What the editor was handed: the daemon's record, not the checkpoint.
      version: input.staleBaseVersion ? accepted.version + 1 : accepted.version,
      onState: (state) => states.push(state),
      debounceMs: 0,
      recover: checkpoints.get("host-1", created.id),
    });
    return { source, created, checkpoints, storage, states, loop };
  }

  test("it is reported as not saved, not as saved", async () => {
    const { states } = await reopened();
    expect(states.some((state) => state.status === "unsaved")).toBe(true);
    expect(states.at(0)?.status).not.toBe("saved");
  });

  test("the recovered text reaches the daemon without another keystroke", async () => {
    const { source, created, loop } = await reopened();
    await loop.flush();
    expect((await source.get(created.id))?.body).toBe("typed while offline");
  });

  test("the checkpoint is dropped once the daemon has it", async () => {
    const { checkpoints, created, loop } = await reopened();
    await loop.flush();
    await settle();
    expect(checkpoints.get("host-1", created.id)).toBeUndefined();
  });

  test("text typed against a version someone else moved past is a conflict, not an overwrite", async () => {
    const { source, created, loop, states } = await reopened({ staleBaseVersion: true });
    await loop.flush();
    expect(states.some((state) => state.status === "conflict")).toBe(true);
    // The other client's text is still there; nothing was silently overwritten.
    expect((await source.get(created.id))?.body).toBe("written elsewhere");
  });
});
