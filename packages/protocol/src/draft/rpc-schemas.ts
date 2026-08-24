import { z } from "zod";
import {
  ArtifactRecordSchema,
  DispatchRecordSchema,
  DraftSendTargetSchema,
  PlannedTargetSchema,
  SnapshotRecordSchema,
} from "./types.js";

/**
 * The `draft.*` RPC surface. See design/decisions/0002-protocol.md for why it is
 * shaped this way; the load-bearing parts:
 *
 * - Artifacts and dispatches are replicated in full and pushed. Snapshots are
 *   pulled on demand — a spec sent twenty times is twenty copies of its body,
 *   and they are only ever read when someone opens that row of the lineage.
 * - `upsert` creates as well as updates. Ids are minted by the client, so a
 *   draft nobody wrote in never reaches the disk and discarding it is a
 *   non-event rather than a delete the sync layer has to replicate.
 * - A stale `baseVersion` is not an error response. It comes back as a normal
 *   response carrying `conflict`, the record as it now stands, so the client can
 *   offer reload-or-overwrite without a second round trip. Overwrite is that
 *   same request again with the version it was just shown — there is no force
 *   flag to misuse.
 */

export const DraftListArtifactsRequestSchema = z.object({
  type: z.literal("draft.list_artifacts.request"),
  requestId: z.string(),
  includeArchived: z.boolean().optional(),
});

export const DraftListArtifactsResponseSchema = z.object({
  type: z.literal("draft.list_artifacts.response"),
  payload: z.object({
    requestId: z.string(),
    artifacts: z.array(ArtifactRecordSchema),
  }),
});

export const DraftGetArtifactRequestSchema = z.object({
  type: z.literal("draft.get_artifact.request"),
  requestId: z.string(),
  artifactId: z.string(),
});

export const DraftGetArtifactResponseSchema = z.object({
  type: z.literal("draft.get_artifact.response"),
  payload: z.object({
    requestId: z.string(),
    artifact: ArtifactRecordSchema.nullable(),
    dispatches: z.array(DispatchRecordSchema),
  }),
});

/**
 * Creates when the record does not exist, which is how a client-minted id first
 * reaches the disk. `baseVersion: 0` says "this is a creation".
 */
export const DraftUpsertArtifactRequestSchema = z.object({
  type: z.literal("draft.upsert_artifact.request"),
  requestId: z.string(),
  artifactId: z.string(),
  baseVersion: z.number().int().nonnegative(),
  title: z.string().nullable().optional(),
  body: z.string().optional(),
  /** Only honoured on creation; changing plans afterwards goes through set_planned. */
  planned: z.array(PlannedTargetSchema).optional(),
});

export const DraftUpsertArtifactResponseSchema = z.object({
  type: z.literal("draft.upsert_artifact.response"),
  payload: z.object({
    requestId: z.string(),
    artifact: ArtifactRecordSchema.nullable(),
    /** Non-null when `baseVersion` was stale. The write did not happen. */
    conflict: ArtifactRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const DraftSetPlannedRequestSchema = z.object({
  type: z.literal("draft.set_planned.request"),
  requestId: z.string(),
  artifactId: z.string(),
  planned: z.array(PlannedTargetSchema),
});

export const DraftSetPlannedResponseSchema = z.object({
  type: z.literal("draft.set_planned.response"),
  payload: z.object({
    requestId: z.string(),
    artifact: ArtifactRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const DraftSetArchivedRequestSchema = z.object({
  type: z.literal("draft.set_archived.request"),
  requestId: z.string(),
  artifactId: z.string(),
  archived: z.boolean(),
});

export const DraftSetArchivedResponseSchema = z.object({
  type: z.literal("draft.set_archived.response"),
  payload: z.object({
    requestId: z.string(),
    artifact: ArtifactRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const DraftGetSnapshotRequestSchema = z.object({
  type: z.literal("draft.get_snapshot.request"),
  requestId: z.string(),
  artifactId: z.string(),
  rev: z.number().int().positive(),
});

export const DraftGetSnapshotResponseSchema = z.object({
  type: z.literal("draft.get_snapshot.response"),
  payload: z.object({
    requestId: z.string(),
    snapshot: SnapshotRecordSchema.nullable(),
  }),
});

/**
 * Sending is two RPCs with the client's own call to `createAgent` or
 * `sendMessage` in between, not one call that does everything. ADR-0003:
 * choosing a provider and model is a whole existing surface in the app, and
 * putting the orchestration in the daemon would mean rebuilding it there.
 *
 * First half: freeze the current body as revision `version` and record the
 * intent to send it. Idempotent — asking twice for the same revision returns the
 * snapshot already on disk, because rewriting one would break both the
 * immutability guarantee and the sync layout that rests on it.
 */
export const DraftCaptureRevisionRequestSchema = z.object({
  type: z.literal("draft.capture_revision.request"),
  requestId: z.string(),
  artifactId: z.string(),
  target: DraftSendTargetSchema,
});

export const DraftCaptureRevisionResponseSchema = z.object({
  type: z.literal("draft.capture_revision.response"),
  payload: z.object({
    requestId: z.string(),
    artifact: ArtifactRecordSchema.nullable(),
    snapshot: SnapshotRecordSchema.nullable(),
    /**
     * Carries the `clientMessageId` to pass to `createAgent`/`sendMessage`, and
     * the `id` to settle afterwards. `status: "pending"` is a real answer, not a
     * failure — nothing has been sent yet, and the record says so.
     */
    dispatch: DispatchRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

/**
 * Second half: what became of the send. Appended rather than rewritten, so the
 * log stays append-only and a crash can lose at most the last line.
 *
 * A client that captures and then never settles leaves a permanent pending
 * dispatch. That is a correct record of what is known, and the UI says so; it is
 * not a state the daemon can resolve on the client's behalf.
 */
export const DraftSettleDispatchRequestSchema = z.object({
  type: z.literal("draft.settle_dispatch.request"),
  requestId: z.string(),
  artifactId: z.string(),
  dispatchId: z.string(),
  status: z.enum(["sent", "failed"]),
  agentId: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const DraftSettleDispatchResponseSchema = z.object({
  type: z.literal("draft.settle_dispatch.response"),
  payload: z.object({
    requestId: z.string(),
    dispatch: DispatchRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

/**
 * A push, not an RPC pair, so it has no matching `.request`. The shape follows
 * `workspace_update`. `rpc-namespacing.md` asks that a name without a partner be
 * called out where the schema is, so: this is that call-out.
 */
export const DraftArtifactUpdateSchema = z.object({
  type: z.literal("draft.artifact_update"),
  payload: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("upsert"),
      artifact: ArtifactRecordSchema,
      dispatches: z.array(DispatchRecordSchema).optional(),
    }),
    z.object({
      kind: z.literal("remove"),
      artifactId: z.string(),
    }),
  ]),
});

export type DraftListArtifactsRequest = z.infer<typeof DraftListArtifactsRequestSchema>;
export type DraftListArtifactsResponse = z.infer<typeof DraftListArtifactsResponseSchema>;
export type DraftGetArtifactRequest = z.infer<typeof DraftGetArtifactRequestSchema>;
export type DraftGetArtifactResponse = z.infer<typeof DraftGetArtifactResponseSchema>;
export type DraftUpsertArtifactRequest = z.infer<typeof DraftUpsertArtifactRequestSchema>;
export type DraftUpsertArtifactResponse = z.infer<typeof DraftUpsertArtifactResponseSchema>;
export type DraftSetPlannedRequest = z.infer<typeof DraftSetPlannedRequestSchema>;
export type DraftSetPlannedResponse = z.infer<typeof DraftSetPlannedResponseSchema>;
export type DraftSetArchivedRequest = z.infer<typeof DraftSetArchivedRequestSchema>;
export type DraftSetArchivedResponse = z.infer<typeof DraftSetArchivedResponseSchema>;
export type DraftGetSnapshotRequest = z.infer<typeof DraftGetSnapshotRequestSchema>;
export type DraftGetSnapshotResponse = z.infer<typeof DraftGetSnapshotResponseSchema>;
export type DraftCaptureRevisionRequest = z.infer<typeof DraftCaptureRevisionRequestSchema>;
export type DraftCaptureRevisionResponse = z.infer<typeof DraftCaptureRevisionResponseSchema>;
export type DraftSettleDispatchRequest = z.infer<typeof DraftSettleDispatchRequestSchema>;
export type DraftSettleDispatchResponse = z.infer<typeof DraftSettleDispatchResponseSchema>;
export type DraftArtifactUpdate = z.infer<typeof DraftArtifactUpdateSchema>;
