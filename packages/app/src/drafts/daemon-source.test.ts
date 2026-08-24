import { describe, expect, test, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ArtifactRecord, DispatchRecord } from "@getpaseo/protocol/draft/types";
import { DaemonDraftsSource } from "./daemon-source";
import { DraftVersionConflictError } from "./source";

/**
 * The source against a daemon that records what it was asked to do. What is
 * being pinned is the order and the evidence — a send is three steps, and each
 * one has to leave the right thing behind whether or not the next one happens.
 */

function record(over: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: "drf_1",
    title: null,
    body: "the next instruction",
    version: 1,
    planned: [],
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

function dispatch(over: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    id: "dsp_1",
    rev: 1,
    clientMessageId: "cmi_1",
    agentId: null,
    workspaceId: "ws-1",
    createdAt: "2026-08-24T00:00:00.000Z",
    status: "pending",
    error: null,
    ...over,
  };
}

function harness(over: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const client = {
    listDraftArtifacts: vi.fn(() => {
      calls.push("list");
      return Promise.resolve([record()]);
    }),
    getDraftArtifact: vi.fn(() =>
      Promise.resolve({ artifact: record(), dispatches: [] as DispatchRecord[] }),
    ),
    upsertDraftArtifact: vi.fn((input: { baseVersion: number }) => {
      calls.push(`upsert:${input.baseVersion}`);
      return Promise.resolve({
        artifact: record({ version: input.baseVersion + 1 }),
        conflict: null,
      });
    }),
    setDraftPlanned: vi.fn(() => Promise.resolve(record())),
    setDraftArchived: vi.fn(() => Promise.resolve(record({ archivedAt: "now" }))),
    captureDraftRevision: vi.fn(() => {
      calls.push("capture");
      return Promise.resolve({
        artifact: record(),
        snapshot: { rev: 1, createdAt: "2026-08-24T00:00:00.000Z", body: "sent exactly this" },
        dispatch: dispatch(),
      });
    }),
    settleDraftDispatch: vi.fn((input: { status: string }) => {
      calls.push(`settle:${input.status}`);
      return Promise.resolve(dispatch({ status: input.status as DispatchRecord["status"] }));
    }),
    on: vi.fn(() => () => undefined),
    ...over,
  };
  const createAgent = vi.fn(() => {
    calls.push("createAgent");
    return Promise.resolve({ agentId: "agent-1" });
  });
  const sendToAgent = vi.fn(() => {
    calls.push("sendToAgent");
    return Promise.resolve();
  });
  const source = new DaemonDraftsSource({
    client: client as unknown as DaemonClient,
    createAgent,
    sendToAgent,
  });
  return { source, client, createAgent, sendToAgent, calls };
}

describe("a draft that nobody has written in", () => {
  test("creating one sends nothing to the daemon", async () => {
    const { source, client } = harness();
    const created = await source.create();

    expect(client.upsertDraftArtifact).not.toHaveBeenCalled();
    expect(created.id).toMatch(/^drf_/);
    // Zero is both "not on the daemon" and the base version the first save
    // carries, which is what tells the daemon to create it.
    expect(created.version).toBe(0);
  });

  test("it still shows up in the list, because you are typing in it", async () => {
    const { source } = harness();
    const created = await source.create();
    const listed = await source.list();

    expect(listed.map((entry) => entry.id)).toContain(created.id);
  });

  test("discarding it is a local non-event", async () => {
    const { source, client } = harness();
    const created = await source.create();
    await source.discard(created.id);

    expect(await source.list()).not.toContainEqual(expect.objectContaining({ id: created.id }));
    // Nothing to delete on disk means nothing for a one-way sync to resurrect.
    expect(client.upsertDraftArtifact).not.toHaveBeenCalled();
  });

  test("the first save creates it, and carries the plan made before it existed", async () => {
    const { source, client } = harness();
    const created = await source.create({ planned: [{ kind: "workspace", workspaceId: "ws-1" }] });
    await source.update({ artifactId: created.id, baseVersion: 0, body: "first words" });

    expect(client.upsertDraftArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVersion: 0,
        body: "first words",
        planned: [{ kind: "workspace", workspaceId: "ws-1" }],
      }),
    );
  });

  test("planning before the first save is held here, not sent", async () => {
    const { source, client } = harness();
    const created = await source.create();
    const planned = await source.setPlanned({
      artifactId: created.id,
      planned: [{ kind: "workspace", workspaceId: "ws-2" }],
    });

    expect(client.setDraftPlanned).not.toHaveBeenCalled();
    expect(planned.planned).toEqual([{ kind: "workspace", workspaceId: "ws-2" }]);
  });
});

describe("saving", () => {
  test("a conflict becomes the error the editor already knows", async () => {
    const { source, client } = harness({
      upsertDraftArtifact: vi.fn(() =>
        Promise.resolve({ artifact: record({ version: 5 }), conflict: record({ version: 5 }) }),
      ),
    });

    await expect(
      source.update({ artifactId: "drf_1", baseVersion: 2, body: "written here" }),
    ).rejects.toBeInstanceOf(DraftVersionConflictError);
    expect(client.upsertDraftArtifact).toHaveBeenCalledOnce();
  });
});

describe("sending", () => {
  test("captures, creates the agent, then settles — in that order", async () => {
    const { source, calls } = harness();
    await source.send({
      artifactId: "drf_1",
      target: { kind: "new_agent", workspaceId: "ws-1", provider: "claude" },
    });

    expect(calls).toEqual(["capture", "createAgent", "settle:sent"]);
  });

  test("the agent gets the snapshot, not whatever the draft says now", async () => {
    const { source, createAgent } = harness();
    await source.send({
      artifactId: "drf_1",
      target: { kind: "new_agent", workspaceId: "ws-1", provider: "claude" },
    });

    // INV-A at the seam: editing during a send must not change what was sent.
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ body: "sent exactly this", clientMessageId: "cmi_1" }),
    );
  });

  test("the new agent is labelled with the draft and revision it came from", async () => {
    const { source, createAgent } = harness();
    await source.send({
      artifactId: "drf_1",
      target: { kind: "new_agent", workspaceId: "ws-1", provider: "claude" },
    });

    // The reverse index: asking a session where it came from does not mean
    // scanning every draft's lineage.
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: { "paseo.draft.artifact": "drf_1", "paseo.draft.rev": "1" },
      }),
    );
  });

  test("sending to an existing agent uses the ordinary message path", async () => {
    const { source, calls, sendToAgent } = harness();
    await source.send({
      artifactId: "drf_1",
      target: { kind: "existing_agent", agentId: "agent-9", workspaceId: "ws-1" },
    });

    expect(calls).toEqual(["capture", "sendToAgent", "settle:sent"]);
    expect(sendToAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-9", clientMessageId: "cmi_1" }),
    );
  });

  test("a failed send is recorded as failed, and still reported to the caller", async () => {
    const { calls, client } = harness();
    const failing = new DaemonDraftsSource({
      client: client as unknown as DaemonClient,
      createAgent: () => {
        calls.push("createAgent");
        return Promise.reject(new Error("provider refused"));
      },
      sendToAgent: () => Promise.resolve(),
    });

    await expect(
      failing.send({
        artifactId: "drf_1",
        target: { kind: "new_agent", workspaceId: "ws-1", provider: "claude" },
      }),
    ).rejects.toThrow("provider refused");

    expect(calls).toEqual(["capture", "createAgent", "settle:failed"]);
    expect(client.settleDraftDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "provider refused" }),
    );
  });

  test("a send that cannot even be settled still surfaces the original failure", async () => {
    const { calls, client } = harness({
      settleDraftDispatch: vi.fn(() => Promise.reject(new Error("daemon unreachable"))),
    });
    const failing = new DaemonDraftsSource({
      client: client as unknown as DaemonClient,
      createAgent: () => Promise.reject(new Error("provider refused")),
      sendToAgent: () => Promise.resolve(),
    });

    // The settle failure must not replace the reason the send failed.
    await expect(
      failing.send({
        artifactId: "drf_1",
        target: { kind: "new_agent", workspaceId: "ws-1", provider: "claude" },
      }),
    ).rejects.toThrow("provider refused");
    void calls;
  });
});

describe("pushes", () => {
  test("subscribing listens once, however many listeners there are", () => {
    const { source, client } = harness();
    const first = source.subscribe(() => undefined);
    const second = source.subscribe(() => undefined);

    expect(client.on).toHaveBeenCalledOnce();
    expect(client.on).toHaveBeenCalledWith("draft.artifact_update", expect.any(Function));
    first();
    second();
  });
});
