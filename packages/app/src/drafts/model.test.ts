import { describe, expect, test } from "vitest";
import {
  dispatchesInto,
  isPlannedFor,
  isProjectLevelPlanFor,
  scratchpadBadgeCount,
  selectWorkspaceDraftSections,
  type ArtifactDetail,
  type ArtifactDispatch,
  type PlannedTarget,
  type WorkspaceProjectLookup,
} from "./model";
import { MockDraftsSource } from "./mock-source";
import { DraftVersionConflictError } from "./source";

const WORKSPACE_TO_PROJECT: Record<string, string> = {
  ws_main: "prj_paseo",
  ws_neo: "prj_paseo",
  ws_torch: "prj_torch",
};

const lookup: WorkspaceProjectLookup = {
  projectIdForWorkspace: (workspaceId) => WORKSPACE_TO_PROJECT[workspaceId] ?? null,
};

function artifact(input: Partial<ArtifactDetail> & { id: string }): ArtifactDetail {
  return {
    title: null,
    body: "",
    version: 1,
    planned: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    archivedAt: null,
    snapshots: [],
    dispatches: [],
    ...input,
  };
}

function dispatch(input: Partial<ArtifactDispatch> & { rev: number }): ArtifactDispatch {
  return {
    id: `dsp_${input.rev}`,
    clientMessageId: `cmid_${input.rev}`,
    agentId: "agt_1",
    workspaceId: "ws_main",
    createdAt: "2026-08-01T00:00:00.000Z",
    status: "sent",
    error: null,
    ...input,
  };
}

const plannedHere: PlannedTarget[] = [{ kind: "workspace", workspaceId: "ws_main" }];

describe("planned is derived, never stored", () => {
  test("a draft planned here with nothing sent is planned", () => {
    const draft = artifact({ id: "a", planned: plannedHere, version: 3 });
    expect(isPlannedFor(draft, "ws_main", lookup)).toBe(true);
  });

  test("sending the current revision moves it out of planned", () => {
    const draft = artifact({
      id: "a",
      planned: plannedHere,
      version: 3,
      dispatches: [dispatch({ rev: 3 })],
    });
    expect(isPlannedFor(draft, "ws_main", lookup)).toBe(false);
  });

  test("editing after a send brings it back to planned", () => {
    const draft = artifact({
      id: "a",
      planned: plannedHere,
      version: 4, // edited past the revision that was sent
      dispatches: [dispatch({ rev: 3 })],
    });
    expect(isPlannedFor(draft, "ws_main", lookup)).toBe(true);
  });

  test("a send into another workspace leaves this one still planned", () => {
    const draft = artifact({
      id: "a",
      planned: plannedHere,
      version: 3,
      dispatches: [dispatch({ rev: 3, workspaceId: "ws_torch" })],
    });
    expect(isPlannedFor(draft, "ws_main", lookup)).toBe(true);
  });

  test("an archived draft is never planned", () => {
    const draft = artifact({
      id: "a",
      planned: plannedHere,
      version: 3,
      archivedAt: "2026-08-02T00:00:00.000Z",
    });
    expect(isPlannedFor(draft, "ws_main", lookup)).toBe(false);
  });
});

describe("project-level plans", () => {
  const projectPlanned: PlannedTarget[] = [{ kind: "project", projectId: "prj_paseo" }];

  test("a project plan makes the draft planned in every workspace of that project", () => {
    const draft = artifact({ id: "a", planned: projectPlanned, version: 1 });
    expect(isPlannedFor(draft, "ws_main", lookup)).toBe(true);
    expect(isPlannedFor(draft, "ws_neo", lookup)).toBe(true);
    expect(isPlannedFor(draft, "ws_torch", lookup)).toBe(false);
  });

  test("a project plan counts a send into any workspace of the project as done", () => {
    const draft = artifact({
      id: "a",
      planned: projectPlanned,
      version: 2,
      dispatches: [dispatch({ rev: 2, workspaceId: "ws_neo" })],
    });
    // Sent into a sibling workspace of the same project, so ws_main is settled too.
    expect(dispatchesInto(draft, "ws_main", lookup)).toHaveLength(1);
    expect(isPlannedFor(draft, "ws_main", lookup)).toBe(false);
  });

  test("a workspace plan does not absorb sends from sibling workspaces", () => {
    const draft = artifact({
      id: "a",
      planned: plannedHere,
      version: 2,
      dispatches: [dispatch({ rev: 2, workspaceId: "ws_neo" })],
    });
    expect(dispatchesInto(draft, "ws_main", lookup)).toHaveLength(0);
    expect(isPlannedFor(draft, "ws_main", lookup)).toBe(true);
  });

  test("only a project-level plan marks the row as secondary", () => {
    const projectOnly = artifact({ id: "a", planned: projectPlanned });
    const both = artifact({ id: "b", planned: [...projectPlanned, ...plannedHere] });
    expect(isProjectLevelPlanFor(projectOnly, "ws_main", lookup)).toBe(true);
    expect(isProjectLevelPlanFor(both, "ws_main", lookup)).toBe(false);
  });
});

describe("scratchpad sections", () => {
  test("a draft that ran here and was then edited appears in both sections", () => {
    const draft = artifact({
      id: "a",
      planned: plannedHere,
      version: 4,
      dispatches: [dispatch({ rev: 3 })],
    });
    const sections = selectWorkspaceDraftSections({
      artifacts: [draft],
      workspaceId: "ws_main",
      lookup,
    });
    expect(sections.planned.map((entry) => entry.id)).toEqual(["a"]);
    expect(sections.executed.map((entry) => entry.id)).toEqual(["a"]);
  });

  test("a draft never planned or sent here appears in neither", () => {
    const draft = artifact({ id: "a", planned: [{ kind: "workspace", workspaceId: "ws_torch" }] });
    const sections = selectWorkspaceDraftSections({
      artifacts: [draft],
      workspaceId: "ws_main",
      lookup,
    });
    expect(sections.planned).toHaveLength(0);
    expect(sections.executed).toHaveLength(0);
  });

  test("the badge counts only the planned section", () => {
    const artifacts = [
      artifact({ id: "a", planned: plannedHere, version: 1 }),
      artifact({ id: "b", planned: plannedHere, version: 2, dispatches: [dispatch({ rev: 2 })] }),
    ];
    expect(scratchpadBadgeCount({ artifacts, workspaceId: "ws_main", lookup })).toBe(1);
  });
});

describe("MockDraftsSource matches the contract the real store enforces", () => {
  test("a new draft has no title, no body and no plan", async () => {
    const source = new MockDraftsSource();
    const created = await source.create();
    expect(created.title).toBeNull();
    expect(created.body).toBe("");
    expect(created.planned).toEqual([]);
  });

  test("creating from the scratchpad pre-plans the current workspace", async () => {
    const source = new MockDraftsSource();
    const created = await source.create({ planned: plannedHere });
    expect(created.planned).toEqual(plannedHere);
  });

  test("a stale baseVersion is rejected so the UI has a conflict branch to write", async () => {
    const source = new MockDraftsSource();
    const created = await source.create();
    await source.update({ artifactId: created.id, baseVersion: created.version, body: "first" });

    await expect(
      source.update({ artifactId: created.id, baseVersion: created.version, body: "second" }),
    ).rejects.toBeInstanceOf(DraftVersionConflictError);
  });

  test("sending freezes a snapshot that later edits do not touch", async () => {
    const source = new MockDraftsSource();
    const created = await source.create();
    const written = await source.update({
      artifactId: created.id,
      baseVersion: created.version,
      body: "revision one",
    });
    const { artifact: sent } = await source.send({
      artifactId: created.id,
      target: { kind: "new_agent", workspaceId: "ws_main" },
    });
    expect(sent.snapshots).toHaveLength(1);
    expect(sent.snapshots[0]?.rev).toBe(written.version);

    await source.update({
      artifactId: created.id,
      baseVersion: written.version,
      body: "revision two",
    });
    const after = await source.get(created.id);
    expect(after?.body).toBe("revision two");
    expect(after?.snapshots[0]?.body).toBe("revision one");
  });

  test("sending the same revision twice does not add a second snapshot", async () => {
    const source = new MockDraftsSource();
    const created = await source.create();
    await source.send({
      artifactId: created.id,
      target: { kind: "new_agent", workspaceId: "ws_main" },
    });
    const { artifact: second } = await source.send({
      artifactId: created.id,
      target: { kind: "existing_agent", agentId: "agt_x", workspaceId: "ws_main" },
    });
    expect(second.snapshots).toHaveLength(1);
    expect(second.dispatches).toHaveLength(2);
  });

  test("search covers title and body and narrows the list", async () => {
    const source = new MockDraftsSource();
    const first = await source.create();
    await source.update({
      artifactId: first.id,
      baseVersion: first.version,
      body: "make the parser incremental",
    });
    const second = await source.create();
    await source.update({
      artifactId: second.id,
      baseVersion: second.version,
      body: "design the ABI bridge",
    });

    expect((await source.list({ search: "parser" })).map((entry) => entry.id)).toEqual([first.id]);
    expect((await source.list({ search: "ABI" })).map((entry) => entry.id)).toEqual([second.id]);
    expect(await source.list({ search: "parser bridge" })).toHaveLength(0);
  });

  test("subscribers are notified on every mutation", async () => {
    const source = new MockDraftsSource();
    let notifications = 0;
    const unsubscribe = source.subscribe(() => {
      notifications += 1;
    });
    const created = await source.create();
    await source.update({ artifactId: created.id, baseVersion: created.version, body: "x" });
    unsubscribe();
    await source.create();
    expect(notifications).toBe(2);
  });
});
