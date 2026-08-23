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
