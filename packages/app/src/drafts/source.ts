import type { ArtifactDetail, ArtifactSnapshot, ArtifactSummary, PlannedTarget } from "./model";

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
  /**
   * `provider` is required because sending has to run something, and choosing
   * what is this side's business — the daemon deliberately does not orchestrate
   * the send (ADR-0003), so nothing downstream can supply a default. Requiring
   * it here makes a send path that forgot to ask a compile error.
   */
  | { kind: "new_agent"; workspaceId: string; provider: string; model?: string | null }
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
  /**
   * One historical revision. Pulled on its own rather than riding along with the
   * draft: a spec sent twenty times is twenty copies of its body, and they are
   * only ever read when someone opens that row of the lineage. Immutable, so
   * whatever comes back can be held onto forever.
   */
  getSnapshot(input: { artifactId: string; rev: number }): Promise<ArtifactSnapshot | null>;
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
  /** Removes a draft outright. Only ever used for one nobody wrote in. */
  discard(artifactId: string): Promise<void>;
  /** Captures the current revision as an immutable snapshot and dispatches it. */
  send(input: { artifactId: string; target: SendTarget }): Promise<SendResult>;
  subscribe(listener: () => void): () => void;
}
