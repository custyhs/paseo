import type { ArtifactDetail, ArtifactSummary, PlannedTarget } from "./model";

/**
 * The one seam between the drafts UI and whatever is storing drafts. The UI is
 * written against this; a mock implementation lets the screens be built and
 * iterated before the daemon RPCs exist, and swapping in the real client later
 * changes nothing above this line.
 *
 * Two properties are load-bearing and must hold in every implementation,
 * including the mock — a mock that skips them lets UI states go unwritten:
 *
 * - Every method is async, even when the mock answers from memory.
 * - `update` takes `baseVersion` and rejects a stale write. The conflict branch
 *   is real UI, so the mock has to be able to produce it.
 */

export type DraftFilter = { kind: "all" } | { kind: "planned"; target: PlannedTarget };

export interface DraftListQuery {
  filter?: DraftFilter;
  search?: string;
  includeArchived?: boolean;
}

export type SendTarget =
  | { kind: "new_agent"; workspaceId: string }
  | { kind: "existing_agent"; agentId: string; workspaceId: string };

export interface SendResult {
  artifact: ArtifactDetail;
  dispatchId: string;
}

export class DraftVersionConflictError extends Error {
  readonly artifactId: string;
  readonly actualVersion: number;

  constructor(input: { artifactId: string; actualVersion: number }) {
    super(`Draft ${input.artifactId} changed elsewhere (now version ${input.actualVersion})`);
    this.name = "DraftVersionConflictError";
    this.artifactId = input.artifactId;
    this.actualVersion = input.actualVersion;
  }
}

export interface DraftsSource {
  list(query?: DraftListQuery): Promise<ArtifactSummary[]>;
  get(artifactId: string): Promise<ArtifactDetail | null>;
  /** Creates an empty draft. `planned` is how the scratchpad pre-plans the current workspace. */
  create(input?: { planned?: PlannedTarget[] }): Promise<ArtifactDetail>;
  update(input: {
    artifactId: string;
    baseVersion: number;
    title?: string | null;
    body?: string;
  }): Promise<ArtifactDetail>;
  setPlanned(input: { artifactId: string; planned: PlannedTarget[] }): Promise<ArtifactDetail>;
  setArchived(input: { artifactId: string; archived: boolean }): Promise<ArtifactDetail>;
  /** Captures the current revision as an immutable snapshot and dispatches it. */
  send(input: { artifactId: string; target: SendTarget }): Promise<SendResult>;
  subscribe(listener: () => void): () => void;
}
