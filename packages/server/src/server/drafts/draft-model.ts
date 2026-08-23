/**
 * Durable prompt drafts. The record shapes live in the protocol package because
 * the wire and the daemon's own files carry the same records; see
 * `@getpaseo/protocol/draft/types` for why they are `z.object` rather than
 * `z.strictObject` on both sides.
 *
 * What stays here is storage's own business: the errors the store raises and the
 * file naming that makes a directory listing sort by revision. The on-disk shape
 * is deliberately split three ways so that a scanning incremental sync (rsync
 * and friends) never re-sends what it already has — the small mutable record in
 * one file, every snapshot written once and then frozen, dispatches only ever
 * appended. See design/decisions/0001-storage-layout.md.
 */

export {
  ARTIFACT_ID_PREFIX,
  ArtifactRecordSchema,
  DispatchRecordSchema,
  DispatchStatusSchema,
  DraftSendTargetSchema,
  PlannedTargetSchema,
  SnapshotRecordSchema,
  type ArtifactRecord,
  type DispatchRecord,
  type DispatchStatus,
  type DraftSendTarget,
  type PlannedTarget,
  type SnapshotRecord,
} from "@getpaseo/protocol/draft/types";

import type {
  ArtifactRecord,
  DispatchRecord,
  SnapshotRecord,
} from "@getpaseo/protocol/draft/types";

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
