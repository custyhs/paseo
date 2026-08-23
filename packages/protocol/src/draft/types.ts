import { z } from "zod";

/**
 * Durable prompt drafts. The product calls these "Drafts"; the code calls them
 * artifacts, because `docs/glossary.md` already spends "Draft" on the composer's
 * draft tab, `DraftAgentControls`, and review drafts.
 *
 * These records are the source of truth for both the wire and the daemon's own
 * files. One definition rather than two, and `z.object` rather than
 * `z.strictObject` on both sides for the same reason: unknown keys are stripped,
 * not rejected. On the wire that is the backward-compatibility contract. On disk
 * it matters just as much — daemon storage has no migrations, and a strict
 * reader would fail on a file written by a newer daemon, which the storage layer
 * reports by skipping the draft. A draft that silently vanishes is the exact
 * failure this feature exists to prevent.
 */

export const ARTIFACT_ID_PREFIX = "drf_";

/**
 * Where the user intends to run a draft. Declared, multi-valued, and freely
 * removable — the retrospective half of the relationship is the dispatch log,
 * which is derived and immutable.
 *
 * `projectKey` rides along unused so a future cross-host mapping has somewhere
 * to land; it is the daemon-agnostic equivalence key described in the glossary.
 */
export const PlannedTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("workspace"),
    workspaceId: z.string(),
  }),
  z.object({
    kind: z.literal("project"),
    projectId: z.string(),
    projectKey: z.string().nullable().optional(),
  }),
]);
export type PlannedTarget = z.infer<typeof PlannedTargetSchema>;

export const ArtifactRecordSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  body: z.string(),
  /** Monotonic; the optimistic-concurrency token callers pass back as baseVersion. */
  version: z.number().int().positive(),
  planned: z.array(PlannedTargetSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});
export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>;

/** Written once and never rewritten. Rewriting one breaks INV-A and defeats the sync layout. */
export const SnapshotRecordSchema = z.object({
  rev: z.number().int().positive(),
  createdAt: z.string(),
  body: z.string(),
});
export type SnapshotRecord = z.infer<typeof SnapshotRecordSchema>;

export const DispatchStatusSchema = z.enum(["pending", "sent", "failed"]);
export type DispatchStatus = z.infer<typeof DispatchStatusSchema>;

/**
 * One send. `clientMessageId` is the bridge Paseo already carries on both send
 * paths — `create_agent_request.clientMessageId` for a new agent and
 * `send_agent_message.messageId` for a follow-up, which the daemon maps onto the
 * same field of the persisted `user_message` timeline item.
 */
export const DispatchRecordSchema = z.object({
  id: z.string(),
  rev: z.number().int().positive(),
  clientMessageId: z.string(),
  agentId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  createdAt: z.string(),
  status: DispatchStatusSchema,
  error: z.string().nullable(),
});
export type DispatchRecord = z.infer<typeof DispatchRecordSchema>;

/** Where a revision is being sent. Both paths share one bridge; see ADR-0003. */
export const DraftSendTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("new_agent"),
    workspaceId: z.string(),
  }),
  z.object({
    kind: z.literal("existing_agent"),
    agentId: z.string(),
    workspaceId: z.string(),
  }),
]);
export type DraftSendTarget = z.infer<typeof DraftSendTargetSchema>;
