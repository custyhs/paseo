/**
 * Client-side model for durable prompt drafts.
 *
 * The product calls these "Drafts"; the code calls them artifacts, because
 * `docs/glossary.md` already spends "Draft" on the composer's draft tab,
 * `DraftAgentControls`, and review drafts. Keeping the code word distinct is the
 * only way to read either one without guessing which is meant.
 *
 * Shapes here mirror the daemon records in
 * `packages/server/src/server/drafts/draft-model.ts`. They are duplicated rather
 * than imported because the app must not depend on server internals; the wire
 * types will eventually come from `@getpaseo/protocol`.
 */

/** Where the user intends to run a draft — declared, multi-valued, removable. */
export type PlannedTarget =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "project"; projectId: string };

export interface ArtifactSnapshot {
  rev: number;
  createdAt: string;
  body: string;
}

export type DispatchStatus = "pending" | "sent" | "failed";

export interface ArtifactDispatch {
  id: string;
  rev: number;
  clientMessageId: string;
  agentId: string | null;
  workspaceId: string | null;
  createdAt: string;
  status: DispatchStatus;
  error: string | null;
}

export interface ArtifactSummary {
  id: string;
  title: string | null;
  body: string;
  version: number;
  planned: PlannedTarget[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ArtifactDetail extends ArtifactSummary {
  snapshots: ArtifactSnapshot[];
  dispatches: ArtifactDispatch[];
}

export function plannedTargetKey(target: PlannedTarget): string {
  return target.kind === "workspace" ? `w:${target.workspaceId}` : `p:${target.projectId}`;
}

export function samePlannedTarget(left: PlannedTarget, right: PlannedTarget): boolean {
  return plannedTargetKey(left) === plannedTargetKey(right);
}

/** Resolves a workspace to the project it belongs to; the app already knows this. */
export interface WorkspaceProjectLookup {
  projectIdForWorkspace(workspaceId: string): string | null;
}

function plannedForWorkspace(
  artifact: ArtifactSummary,
  workspaceId: string,
  lookup: WorkspaceProjectLookup,
): boolean {
  const projectId = lookup.projectIdForWorkspace(workspaceId);
  return artifact.planned.some(
    (target) =>
      (target.kind === "workspace" && target.workspaceId === workspaceId) ||
      (target.kind === "project" && projectId !== null && target.projectId === projectId),
  );
}

/**
 * Dispatches that count as "ran here". A workspace-level plan only counts its
 * own workspace; a project-level plan counts any workspace in that project,
 * because the point of planning at project level is that the workspace did not
 * exist yet when the draft was written.
 */
export function dispatchesInto(
  artifact: ArtifactDetail,
  workspaceId: string,
  lookup: WorkspaceProjectLookup,
): ArtifactDispatch[] {
  const projectId = lookup.projectIdForWorkspace(workspaceId);
  const projectPlanned =
    projectId !== null &&
    artifact.planned.some((target) => target.kind === "project" && target.projectId === projectId);

  return artifact.dispatches.filter((dispatch) => {
    if (dispatch.workspaceId === workspaceId) return true;
    if (!projectPlanned || dispatch.workspaceId === null) return false;
    return lookup.projectIdForWorkspace(dispatch.workspaceId) === projectId;
  });
}

/**
 * "Planned here" is derived, never stored: the draft is planned for this
 * workspace and its current revision has not been sent here yet.
 *
 * That one rule produces the whole iteration loop for free — send revision 17
 * and the draft drops into the history section; edit it afterwards and it
 * returns to the planned section marked as having unsent changes, without the
 * user ever labelling anything.
 */
export function hasUnsentChangesFor(
  artifact: ArtifactDetail,
  workspaceId: string,
  lookup: WorkspaceProjectLookup,
): boolean {
  return !dispatchesInto(artifact, workspaceId, lookup).some(
    (dispatch) => dispatch.rev === artifact.version,
  );
}

export function isPlannedFor(
  artifact: ArtifactDetail,
  workspaceId: string,
  lookup: WorkspaceProjectLookup,
): boolean {
  return (
    artifact.archivedAt === null &&
    plannedForWorkspace(artifact, workspaceId, lookup) &&
    hasUnsentChangesFor(artifact, workspaceId, lookup)
  );
}

/** True when only a project-level plan puts this draft in front of the workspace. */
export function isProjectLevelPlanFor(
  artifact: ArtifactSummary,
  workspaceId: string,
  lookup: WorkspaceProjectLookup,
): boolean {
  const plannedDirectly = artifact.planned.some(
    (target) => target.kind === "workspace" && target.workspaceId === workspaceId,
  );
  if (plannedDirectly) return false;
  const projectId = lookup.projectIdForWorkspace(workspaceId);
  return artifact.planned.some(
    (target) => target.kind === "project" && projectId !== null && target.projectId === projectId,
  );
}

export interface WorkspaceDraftSections {
  planned: ArtifactDetail[];
  executed: ArtifactDetail[];
}

/**
 * The two sections the workspace scratchpad shows. `planned` is the working
 * surface and stays expanded; `executed` is history and collapses by default.
 * A draft can legitimately appear in both — it ran here and has since been
 * edited — and that is the state the user most needs to see.
 */
export function selectWorkspaceDraftSections(input: {
  artifacts: ArtifactDetail[];
  workspaceId: string;
  lookup: WorkspaceProjectLookup;
}): WorkspaceDraftSections {
  const planned: ArtifactDetail[] = [];
  const executed: ArtifactDetail[] = [];
  for (const artifact of input.artifacts) {
    if (isPlannedFor(artifact, input.workspaceId, input.lookup)) planned.push(artifact);
    if (dispatchesInto(artifact, input.workspaceId, input.lookup).length > 0) {
      executed.push(artifact);
    }
  }
  planned.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  executed.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { planned, executed };
}

/** The number the Scratchpad tab shows. It is the only thing advertising the panel. */
export function scratchpadBadgeCount(input: {
  artifacts: ArtifactDetail[];
  workspaceId: string;
  lookup: WorkspaceProjectLookup;
}): number {
  return selectWorkspaceDraftSections(input).planned.length;
}

/**
 * A draft nobody ever wrote in. Leaving the editor discards these rather than
 * letting the list accumulate blank rows the user has to archive by hand —
 * "start writing before organizing" only holds if not-writing costs nothing.
 *
 * A plan does not save it. Creating from the scratchpad plans this workspace
 * automatically, so treating that as intent would exempt the very place blank
 * drafts pile up fastest. Typing is the evidence of intent; a title or a send
 * counts too, since both take a deliberate act.
 */
export function isDiscardableDraft(artifact: ArtifactDetail): boolean {
  return (
    artifact.body.trim().length === 0 &&
    (artifact.title?.trim().length ?? 0) === 0 &&
    artifact.snapshots.length === 0 &&
    artifact.dispatches.length === 0
  );
}

export function draftDisplayTitle(artifact: ArtifactSummary): string | null {
  const trimmed = artifact.title?.trim();
  if (trimmed) return trimmed;
  const firstLine = artifact.body.split("\n").find((line) => line.trim().length > 0);
  return firstLine ? firstLine.trim() : null;
}
