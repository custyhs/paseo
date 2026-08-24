import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DraftStorage } from "../../drafts/draft-storage.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { DraftSession } from "./draft-session.js";

/**
 * The `draft.*` RPC surface against a real store on a real directory. The point
 * of each test is the answer a client gets, not the shape of the code that
 * produced it.
 */

const silentLogger = {
  warn: () => undefined,
  error: () => undefined,
} as unknown as pino.Logger;

let baseDir: string;
let storage: DraftStorage;
let emitted: SessionOutboundMessage[];
let session: DraftSession;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(tmpdir(), "paseo-draft-session-"));
  storage = new DraftStorage(baseDir, silentLogger);
  await storage.initialize();
  emitted = [];
  session = new DraftSession({
    host: { emit: (msg) => emitted.push(msg) },
    storage,
    logger: silentLogger,
  });
});

afterEach(async () => {
  session.stop();
  await fs.rm(baseDir, { recursive: true, force: true });
});

async function send(msg: SessionInboundMessage): Promise<void> {
  const promise = session.dispatch(msg);
  expect(promise, `no handler for ${msg.type}`).toBeDefined();
  await promise;
}

function lastOfType<T extends SessionOutboundMessage["type"]>(
  type: T,
): Extract<SessionOutboundMessage, { type: T }> {
  const found = emitted.toReversed().find((msg) => msg.type === type);
  if (!found) throw new Error(`no ${type} was emitted`);
  return found as Extract<SessionOutboundMessage, { type: T }>;
}

const ID = "drf_0123456789abcdef";

/** The first non-empty save, which is also the creation. */
async function createDraft(body = "the next instruction"): Promise<void> {
  await send({
    type: "draft.upsert_artifact.request",
    requestId: "create",
    artifactId: ID,
    baseVersion: 0,
    body,
  });
}

describe("draft rpcs", () => {
  test("leaves messages it does not own to the rest of the chain", () => {
    expect(session.dispatch({ type: "ping" } as SessionInboundMessage)).toBeUndefined();
  });

  test("a client-minted id creates the record on its first save", async () => {
    await createDraft();
    const response = lastOfType("draft.upsert_artifact.response");
    expect(response.payload.artifact?.id).toBe(ID);
    expect(response.payload.artifact?.version).toBe(1);
    expect(response.payload.conflict).toBeNull();
    expect(await storage.get(ID)).not.toBeNull();
  });

  test("a draft nobody wrote in never reaches the disk", async () => {
    // Creating is a client-side act until there is something to save, so
    // discarding one is a non-event rather than a delete to replicate.
    await send({ type: "draft.list_artifacts.request", requestId: "list" });
    expect(lastOfType("draft.list_artifacts.response").payload.artifacts).toEqual([]);
  });

  test("a stale write comes back as a conflict, not an error", async () => {
    await createDraft();
    await send({
      type: "draft.upsert_artifact.request",
      requestId: "stale",
      artifactId: ID,
      baseVersion: 1,
      body: "written elsewhere",
    });
    await send({
      type: "draft.upsert_artifact.request",
      requestId: "conflicting",
      artifactId: ID,
      baseVersion: 1,
      body: "written here",
    });

    const response = lastOfType("draft.upsert_artifact.response");
    expect(response.payload.error).toBeNull();
    expect(response.payload.conflict?.version).toBe(2);
    // The record as it stands, so the client can offer reload-or-overwrite
    // without a second round trip.
    expect(response.payload.conflict?.body).toBe("written elsewhere");
    expect(emitted.some((msg) => msg.type === "rpc_error")).toBe(false);
  });

  test("overwrite is the same request again with the version it was shown", async () => {
    await createDraft();
    await send({
      type: "draft.upsert_artifact.request",
      requestId: "stale",
      artifactId: ID,
      baseVersion: 1,
      body: "written elsewhere",
    });
    await send({
      type: "draft.upsert_artifact.request",
      requestId: "conflicting",
      artifactId: ID,
      baseVersion: 1,
      body: "written here",
    });
    const conflict = lastOfType("draft.upsert_artifact.response").payload.conflict;
    if (!conflict) throw new Error("expected a conflict");

    await send({
      type: "draft.upsert_artifact.request",
      requestId: "overwrite",
      artifactId: ID,
      baseVersion: conflict.version,
      body: "written here",
    });

    expect(lastOfType("draft.upsert_artifact.response").payload.conflict).toBeNull();
    expect((await storage.get(ID))?.body).toBe("written here");
  });

  test("get returns the record and its lineage, but not its snapshots", async () => {
    await createDraft();
    await storage.captureSnapshot({ artifactId: ID });
    await storage.recordDispatch({ artifactId: ID, rev: 1, clientMessageId: "cmi-1" });

    await send({ type: "draft.get_artifact.request", requestId: "get", artifactId: ID });
    const payload = lastOfType("draft.get_artifact.response").payload;

    expect(payload.artifact?.id).toBe(ID);
    expect(payload.dispatches).toHaveLength(1);
    // A spec sent twenty times is twenty copies of its body. They are pulled one
    // at a time, when someone opens that row of the lineage.
    expect(payload.artifact).not.toHaveProperty("snapshots");
  });

  test("a missing draft is null, not an error", async () => {
    await send({ type: "draft.get_artifact.request", requestId: "get", artifactId: "drf_nope" });
    expect(lastOfType("draft.get_artifact.response").payload.artifact).toBeNull();
    expect(emitted.some((msg) => msg.type === "rpc_error")).toBe(false);
  });

  test("snapshots are pulled one revision at a time", async () => {
    await createDraft("first revision");
    await storage.captureSnapshot({ artifactId: ID });

    await send({
      type: "draft.get_snapshot.request",
      requestId: "snap",
      artifactId: ID,
      rev: 1,
    });
    expect(lastOfType("draft.get_snapshot.response").payload.snapshot?.body).toBe("first revision");

    await send({ type: "draft.get_snapshot.request", requestId: "gone", artifactId: ID, rev: 9 });
    expect(lastOfType("draft.get_snapshot.response").payload.snapshot).toBeNull();
  });

  test("planning and archiving answer with the new record", async () => {
    await createDraft();
    await send({
      type: "draft.set_planned.request",
      requestId: "plan",
      artifactId: ID,
      planned: [{ kind: "workspace", workspaceId: "ws-1" }],
    });
    expect(lastOfType("draft.set_planned.response").payload.artifact?.planned).toEqual([
      { kind: "workspace", workspaceId: "ws-1" },
    ]);

    await send({
      type: "draft.set_archived.request",
      requestId: "archive",
      artifactId: ID,
      archived: true,
    });
    expect(lastOfType("draft.set_archived.response").payload.artifact?.archivedAt).not.toBeNull();

    await send({ type: "draft.list_artifacts.request", requestId: "list" });
    expect(lastOfType("draft.list_artifacts.response").payload.artifacts).toEqual([]);
    await send({
      type: "draft.list_artifacts.request",
      requestId: "list-all",
      includeArchived: true,
    });
    expect(lastOfType("draft.list_artifacts.response").payload.artifacts).toHaveLength(1);
  });

  test("planning a draft that is not there answers, rather than erroring out", async () => {
    await send({
      type: "draft.set_planned.request",
      requestId: "plan",
      artifactId: "drf_nope",
      planned: [],
    });
    const payload = lastOfType("draft.set_planned.response").payload;
    expect(payload.artifact).toBeNull();
    expect(payload.error).not.toBeNull();
  });
});

/**
 * Sending is two RPCs with the client's own `createAgent` between them. What the
 * daemon owns is the evidence: a frozen snapshot and an append-only record of
 * what was attempted.
 */
describe("capturing and settling a send", () => {
  async function capture(target = { kind: "new_agent" as const, workspaceId: "ws-1" }) {
    await send({
      type: "draft.capture_revision.request",
      requestId: "capture",
      artifactId: ID,
      target,
    });
    return lastOfType("draft.capture_revision.response").payload;
  }

  test("freezes the body and hands back the bridge id", async () => {
    await createDraft("send exactly this");
    const payload = await capture();

    expect(payload.snapshot?.body).toBe("send exactly this");
    expect(payload.dispatch?.status).toBe("pending");
    // The id the client passes to createAgent as `clientMessageId`, which is
    // what later ties the draft to a message in the agent's timeline.
    expect(payload.dispatch?.clientMessageId).toBeTruthy();
    expect(payload.error).toBeNull();
  });

  test("the snapshot keeps the sent text even after the draft moves on", async () => {
    await createDraft("send exactly this");
    const captured = await capture();

    await send({
      type: "draft.upsert_artifact.request",
      requestId: "later",
      artifactId: ID,
      baseVersion: 1,
      body: "rewritten afterwards",
    });

    // INV-A. What was sent is not what the draft says now, and the lineage has
    // to show the former.
    await send({
      type: "draft.get_snapshot.request",
      requestId: "snap",
      artifactId: ID,
      rev: captured.snapshot?.rev ?? 0,
    });
    expect(lastOfType("draft.get_snapshot.response").payload.snapshot?.body).toBe(
      "send exactly this",
    );
  });

  test("capturing the same revision twice returns the same snapshot", async () => {
    await createDraft("send exactly this");
    const first = await capture();
    const second = await capture();

    expect(second.snapshot).toEqual(first.snapshot);
    // Two dispatches, one snapshot: sending the same thought to two places is
    // two sends of one revision, not two revisions.
    expect(second.dispatch?.id).not.toBe(first.dispatch?.id);
    expect((await storage.get(ID))?.snapshots).toHaveLength(1);
  });

  test("settling records the agent it reached", async () => {
    await createDraft();
    const captured = await capture();

    await send({
      type: "draft.settle_dispatch.request",
      requestId: "settle",
      artifactId: ID,
      dispatchId: captured.dispatch?.id ?? "",
      status: "sent",
      agentId: "agent-1",
    });

    const settled = lastOfType("draft.settle_dispatch.response").payload.dispatch;
    expect(settled?.status).toBe("sent");
    expect(settled?.agentId).toBe("agent-1");
    // Append-only: the pending line is still there, and the reader folds by id.
    expect((await storage.get(ID))?.dispatches.at(-1)?.status).toBe("sent");
  });

  test("a failed send keeps its snapshot and says it failed", async () => {
    await createDraft("send exactly this");
    const captured = await capture();

    await send({
      type: "draft.settle_dispatch.request",
      requestId: "settle",
      artifactId: ID,
      dispatchId: captured.dispatch?.id ?? "",
      status: "failed",
      error: "provider refused",
    });

    const detail = await storage.get(ID);
    // INV-B: the snapshot is what the user meant to send, and that is worth
    // more when it did not arrive, not less.
    expect(detail?.snapshots).toHaveLength(1);
    expect(detail?.dispatches.at(-1)).toMatchObject({
      status: "failed",
      error: "provider refused",
    });
  });

  test("a client that never settles leaves a pending record, not a lie", async () => {
    await createDraft();
    await capture();

    // The app could die here. What is on disk then is exactly what is known:
    // the send left, and its result is not.
    expect((await storage.get(ID))?.dispatches.at(-1)?.status).toBe("pending");
  });

  test("sending to an existing agent records that agent from the start", async () => {
    await createDraft();
    const payload = await capture({
      kind: "existing_agent",
      agentId: "agent-9",
      workspaceId: "ws-1",
    });
    expect(payload.dispatch?.agentId).toBe("agent-9");
  });

  test("capturing a draft that is not there answers, rather than erroring out", async () => {
    await send({
      type: "draft.capture_revision.request",
      requestId: "capture",
      artifactId: "drf_nope",
      target: { kind: "new_agent", workspaceId: "ws-1" },
    });
    const payload = lastOfType("draft.capture_revision.response").payload;
    expect(payload.snapshot).toBeNull();
    expect(payload.error).not.toBeNull();
    expect(emitted.some((msg) => msg.type === "rpc_error")).toBe(false);
  });

  test("settling a dispatch that is not there answers, rather than erroring out", async () => {
    await createDraft();
    await send({
      type: "draft.settle_dispatch.request",
      requestId: "settle",
      artifactId: ID,
      dispatchId: "nope",
      status: "sent",
      agentId: "agent-1",
    });
    const payload = lastOfType("draft.settle_dispatch.response").payload;
    expect(payload.dispatch).toBeNull();
    expect(payload.error).not.toBeNull();
  });
});

/**
 * Search is the third promise: weeks later, find a thought. What makes it worth
 * a daemon-side RPC is that it reaches revisions the draft no longer contains.
 */
describe("search", () => {
  async function search(query: string) {
    await send({ type: "draft.search.request", requestId: "search", query });
    return lastOfType("draft.search.response").payload.hits;
  }

  test("finds words in a draft's current text", async () => {
    await createDraft("make the parser incremental");
    expect(await search("incremental")).toEqual([
      expect.objectContaining({ artifactId: ID, where: { kind: "artifact" }, archived: false }),
    ]);
  });

  test("finds words the draft no longer contains, in the revision that was sent", async () => {
    await createDraft("reuse the dirty-range tracker");
    await send({
      type: "draft.capture_revision.request",
      requestId: "capture",
      artifactId: ID,
      target: { kind: "new_agent", workspaceId: "ws-1" },
    });
    await send({
      type: "draft.upsert_artifact.request",
      requestId: "rewrite",
      artifactId: ID,
      baseVersion: 1,
      body: "completely different words now",
    });

    // The point of the whole feature. Client-side search cannot do this: the
    // client has the current body and no snapshots.
    const hits = await search("dirty-range");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.where).toEqual({ kind: "snapshot", rev: 1 });
    expect(hits[0]?.excerpt).toContain("dirty-range");
  });

  test("does not report a draft twice for words it never lost", async () => {
    await createDraft("make the parser incremental");
    await send({
      type: "draft.capture_revision.request",
      requestId: "capture",
      artifactId: ID,
      target: { kind: "new_agent", workspaceId: "ws-1" },
    });

    // Snapshot and current body are the same text here; one hit, not two.
    expect(await search("incremental")).toHaveLength(1);
  });

  test("an archived draft is found, and says so", async () => {
    await createDraft("filed away but not gone");
    await send({
      type: "draft.set_archived.request",
      requestId: "archive",
      artifactId: ID,
      archived: true,
    });

    const hits = await search("filed away");
    expect(hits).toHaveLength(1);
    // The caller groups on this rather than the daemon hiding it: weeks later is
    // exactly when an archived draft is worth finding.
    expect(hits[0]?.archived).toBe(true);
  });

  test("only the excerpt of a snapshot crosses the wire, not its body", async () => {
    const long = `${"filler ".repeat(200)}needle ${"filler ".repeat(200)}`;
    await createDraft(long);
    await send({
      type: "draft.capture_revision.request",
      requestId: "capture",
      artifactId: ID,
      target: { kind: "new_agent", workspaceId: "ws-1" },
    });
    await send({
      type: "draft.upsert_artifact.request",
      requestId: "rewrite",
      artifactId: ID,
      baseVersion: 1,
      body: "gone",
    });

    const hits = await search("needle");
    const excerpt = hits[0]?.excerpt ?? "";
    expect(excerpt).toContain("needle");
    // A spec sent twenty times is twenty copies of its body; sending them back
    // for a search result would defeat pulling snapshots on demand.
    expect(excerpt.length).toBeLessThan(long.length / 2);
  });

  test("a query that matches nothing is an empty list, not an error", async () => {
    await createDraft("make the parser incremental");
    expect(await search("nothing like this")).toEqual([]);
    expect(emitted.some((msg) => msg.type === "rpc_error")).toBe(false);
  });
});

describe("pushes", () => {
  test("a write by anyone reaches this client", async () => {
    session.start();
    // Stands in for another client, or the daemon itself, writing.
    await storage.upsert({ id: ID, baseVersion: 0, body: "written elsewhere" });

    const update = lastOfType("draft.artifact_update");
    expect(update.payload.kind === "upsert" && update.payload.artifact.body).toBe(
      "written elsewhere",
    );
  });

  test("lineage changes push the record and the dispatches together", async () => {
    await createDraft();
    session.start();
    await storage.recordDispatch({ artifactId: ID, rev: 1, clientMessageId: "cmi-1" });

    const update = lastOfType("draft.artifact_update");
    expect(update.payload.kind === "upsert" && update.payload.dispatches).toHaveLength(1);
  });

  test("a stopped session stops hearing", async () => {
    session.start();
    session.stop();
    await storage.upsert({ id: ID, baseVersion: 0, body: "written elsewhere" });
    expect(emitted.some((msg) => msg.type === "draft.artifact_update")).toBe(false);
  });
});
