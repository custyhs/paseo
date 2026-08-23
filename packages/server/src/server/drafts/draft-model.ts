import { z } from "zod";

/**
 * Durable prompt drafts. The product calls these "Drafts"; the code calls them
 * artifacts, because `docs/glossary.md` already spends "Draft" on the composer's
 * draft tab, `DraftAgentControls`, and review drafts.
 *
 * The on-disk shape is deliberately split three ways so that a scanning
 * incremental sync (rsync and friends) never re-sends what it already has:
 * the small mutable record lives in one file, every snapshot is written once and
 * then frozen, and dispatches only ever append. See
 * design/decisions/0001-storage-layout.md.
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
  z.strictObject({
    kind: z.literal("workspace"),
    workspaceId: z.string(),
  }),
  z.strictObject({
    kind: z.literal("project"),
    projectId: z.string(),
    projectKey: z.string().nullable().optional(),
  }),
]);
export type PlannedTarget = z.infer<typeof PlannedTargetSchema>;

export const ArtifactRecordSchema = z.strictObject({
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
export const SnapshotRecordSchema = z.strictObject({
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
export const DispatchRecordSchema = z.strictObject({
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

/** What a caller gets back: the three files assembled behind the store surface. */
export interface ArtifactDetail extends ArtifactRecord {
  snapshots: SnapshotRecord[];
  dispatches: DispatchRecord[];
}

export class ArtifactVersionConflictError extends Error {
  readonly artifactId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(input: { artifactId: string; expectedVersion: number; actualVersion: number }) {
    super(
      `Draft ${input.artifactId} changed since version ${input.expectedVersion} (now ${input.actualVersion})`,
    );
    this.name = "ArtifactVersionConflictError";
    this.artifactId = input.artifactId;
    this.expectedVersion = input.expectedVersion;
    this.actualVersion = input.actualVersion;
  }
}

export class ArtifactNotFoundError extends Error {
  readonly artifactId: string;
  constructor(artifactId: string) {
    super(`Draft ${artifactId} not found`);
    this.name = "ArtifactNotFoundError";
    this.artifactId = artifactId;
  }
}

/** Zero-padded so a plain directory listing sorts by revision. */
export function snapshotFileName(rev: number): string {
  return `${String(rev).padStart(4, "0")}.json`;
}

export function parseSnapshotFileName(name: string): number | null {
  const match = /^(\d{4,})\.json$/.exec(name);
  if (!match) return null;
  const rev = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(rev) && rev > 0 ? rev : null;
}
