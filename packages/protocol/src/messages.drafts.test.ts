import { describe, expect, it } from "vitest";
import {
  DraftArtifactUpdateSchema,
  DraftCaptureRevisionResponseSchema,
  DraftUpsertArtifactRequestSchema,
} from "./draft/rpc-schemas";
import { ArtifactRecordSchema } from "./draft/types";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";

const artifact = {
  id: "drf_0123456789abcdef",
  title: null,
  body: "the next instruction",
  version: 3,
  planned: [{ kind: "workspace", workspaceId: "ws-1" }],
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:01:00.000Z",
  archivedAt: null,
};

describe("draft protocol", () => {
  it("routes every draft request through the inbound union", () => {
    const requests = [
      { type: "draft.list_artifacts.request", requestId: "r1" },
      { type: "draft.get_artifact.request", requestId: "r2", artifactId: artifact.id },
      {
        type: "draft.upsert_artifact.request",
        requestId: "r3",
        artifactId: artifact.id,
        baseVersion: 3,
        body: "next",
      },
      {
        type: "draft.set_planned.request",
        requestId: "r4",
        artifactId: artifact.id,
        planned: [{ kind: "project", projectId: "p-1" }],
      },
      {
        type: "draft.set_archived.request",
        requestId: "r5",
        artifactId: artifact.id,
        archived: true,
      },
      { type: "draft.get_snapshot.request", requestId: "r6", artifactId: artifact.id, rev: 2 },
      {
        type: "draft.capture_revision.request",
        requestId: "r7",
        artifactId: artifact.id,
        target: { kind: "new_agent", workspaceId: "ws-1" },
      },
      {
        type: "draft.settle_dispatch.request",
        requestId: "r8",
        artifactId: artifact.id,
        dispatchId: "dsp_1",
        status: "sent",
        agentId: "agent-1",
      },
    ];
    for (const request of requests) {
      expect(SessionInboundMessageSchema.safeParse(request).success, request.type).toBe(true);
    }
  });

  it("routes every draft response through the outbound union", () => {
    const responses = [
      {
        type: "draft.list_artifacts.response",
        payload: { requestId: "r1", artifacts: [artifact] },
      },
      {
        type: "draft.get_artifact.response",
        payload: { requestId: "r2", artifact, dispatches: [] },
      },
      {
        type: "draft.upsert_artifact.response",
        payload: { requestId: "r3", artifact, conflict: null, error: null },
      },
      {
        type: "draft.set_planned.response",
        payload: { requestId: "r4", artifact, error: null },
      },
      {
        type: "draft.set_archived.response",
        payload: { requestId: "r5", artifact, error: null },
      },
      {
        type: "draft.get_snapshot.response",
        payload: {
          requestId: "r6",
          snapshot: { rev: 2, createdAt: artifact.createdAt, body: "x" },
        },
      },
      {
        type: "draft.capture_revision.response",
        payload: {
          requestId: "r7",
          artifact,
          snapshot: { rev: 3, createdAt: artifact.createdAt, body: artifact.body },
          dispatch: null,
          error: null,
        },
      },
      {
        type: "draft.settle_dispatch.response",
        payload: { requestId: "r8", dispatch: null, error: null },
      },
    ];
    for (const response of responses) {
      expect(SessionOutboundMessageSchema.safeParse(response).success, response.type).toBe(true);
    }
  });

  /**
   * The push carries a discriminated union inside `payload`, which is the shape
   * the generated validator has needed patches for before. Going through the
   * shipped boundary rather than Zod is the point of this one.
   */
  it("survives the generated inbound validator, both branches", async () => {
    // Imported here rather than at the top: the generated module and `./messages`
    // form an import cycle, and pulling `./messages` in first leaves this export
    // in its temporal dead zone. The validator takes the session envelope, not
    // the bare message.
    const { validateWSOutboundMessage } = await import("./validation/ws-outbound");
    const validate = (payload: unknown) =>
      validateWSOutboundMessage({
        type: "session",
        message: { type: "draft.artifact_update", payload },
      }).success;

    expect(validate({ kind: "upsert", artifact, dispatches: [] })).toBe(true);
    expect(validate({ kind: "remove", artifactId: artifact.id })).toBe(true);
    expect(validate({ kind: "upsert" })).toBe(false);
  });

  /**
   * The compatibility contract: a newer client may add fields, and an older
   * daemon has to keep parsing. Unknown keys are stripped, never rejected —
   * which is why none of these schemas is a `strictObject`.
   */
  it("tolerates fields it has never heard of", () => {
    const parsed = DraftUpsertArtifactRequestSchema.safeParse({
      type: "draft.upsert_artifact.request",
      requestId: "r1",
      artifactId: artifact.id,
      baseVersion: 1,
      body: "next",
      somethingAddedLater: { nested: true },
    });
    expect(parsed.success).toBe(true);
    expect(ArtifactRecordSchema.safeParse({ ...artifact, addedLater: 1 }).success).toBe(true);
  });

  it("treats a pending dispatch as a real answer", () => {
    // Nothing has been sent yet — the client still has to call createAgent and
    // then settle. `pending` is what is known, not a failure.
    const parsed = DraftCaptureRevisionResponseSchema.safeParse({
      type: "draft.capture_revision.response",
      payload: {
        requestId: "r1",
        artifact,
        snapshot: { rev: 3, createdAt: artifact.createdAt, body: artifact.body },
        dispatch: {
          id: "dsp_1",
          rev: 3,
          clientMessageId: "cmi_1",
          agentId: null,
          workspaceId: "ws-1",
          createdAt: artifact.createdAt,
          status: "pending",
          error: null,
        },
        error: null,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("keeps the capability flag optional so old daemons still parse", () => {
    const base = { status: "server_info", serverId: "srv-1" };
    // A daemon that predates the flag omits it entirely, and still parses.
    expect(ServerInfoStatusPayloadSchema.safeParse({ ...base, features: {} }).success).toBe(true);
    const enabled = ServerInfoStatusPayloadSchema.safeParse({
      ...base,
      features: { drafts: true },
    });
    expect(enabled.success && enabled.data.features?.drafts).toBe(true);
  });

  it("removes by id and upserts by record, and does not confuse the two", () => {
    expect(
      DraftArtifactUpdateSchema.safeParse({
        type: "draft.artifact_update",
        payload: { kind: "remove", artifact },
      }).success,
    ).toBe(false);
  });
});
