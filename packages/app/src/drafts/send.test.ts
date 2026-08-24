import { describe, expect, test } from "vitest";
import { MockDraftsSource } from "./mock-source";
import {
  dispatchesInto,
  isPlannedFor,
  selectWorkspaceDraftSections,
  type ArtifactDetail,
  type WorkspaceProjectLookup,
} from "./model";

const lookup: WorkspaceProjectLookup = {
  projectIdForWorkspace: (workspaceId) =>
    ({ ws_main: "prj_paseo", ws_neo: "prj_paseo", ws_torch: "prj_torch" })[workspaceId] ?? null,
};

async function detail(source: MockDraftsSource, id: string): Promise<ArtifactDetail> {
  const artifact = await source.get(id);
  if (!artifact) throw new Error(`missing ${id}`);
  return artifact;
}

/**
 * The full loop the feature exists for, driven through the same source the UI
 * uses: plan it, write it, send it, keep writing, send again, and be able to
 * read back exactly what each agent got.
 */
describe("send flow end to end", () => {
  test("a planned draft moves to history on send and returns when edited", async () => {
    const source = new MockDraftsSource();
    const created = await source.create({
      planned: [{ kind: "workspace", workspaceId: "ws_main" }],
    });
    const written = await source.update({
      artifactId: created.id,
      baseVersion: created.version,
      body: "make the parser incremental",
    });

    expect(isPlannedFor(await detail(source, created.id), "ws_main", lookup)).toBe(true);

    await source.send({
      artifactId: created.id,
      target: { kind: "new_agent", workspaceId: "ws_main", provider: "claude" },
    });
    const afterSend = await detail(source, created.id);
    expect(isPlannedFor(afterSend, "ws_main", lookup)).toBe(false);
    expect(dispatchesInto(afterSend, "ws_main", lookup)).toHaveLength(1);

    await source.update({
      artifactId: created.id,
      baseVersion: written.version,
      body: "make the parser incremental, and keep the cold path",
    });
    const afterEdit = await detail(source, created.id);
    expect(isPlannedFor(afterEdit, "ws_main", lookup)).toBe(true);

    // Both sections at once: it ran here, and there is newer text that has not.
    const sections = selectWorkspaceDraftSections({
      artifacts: [afterEdit],
      workspaceId: "ws_main",
      lookup,
    });
    expect(sections.planned.map((entry) => entry.id)).toEqual([created.id]);
    expect(sections.executed.map((entry) => entry.id)).toEqual([created.id]);
  });

  test("what each agent received stays readable after later edits", async () => {
    const source = new MockDraftsSource();
    const created = await source.create();
    const first = await source.update({
      artifactId: created.id,
      baseVersion: created.version,
      body: "first ask",
    });
    await source.send({
      artifactId: created.id,
      target: { kind: "new_agent", workspaceId: "ws_main", provider: "claude" },
    });

    const second = await source.update({
      artifactId: created.id,
      baseVersion: first.version,
      body: "second ask",
    });
    await source.send({
      artifactId: created.id,
      target: { kind: "existing_agent", agentId: "agt_codex", workspaceId: "ws_torch" },
    });

    await source.update({
      artifactId: created.id,
      baseVersion: second.version,
      body: "third, still unsent",
    });

    const artifact = await detail(source, created.id);
    expect(artifact.body).toBe("third, still unsent");
    expect(artifact.snapshots.find((entry) => entry.rev === first.version)?.body).toBe("first ask");
    expect(artifact.snapshots.find((entry) => entry.rev === second.version)?.body).toBe(
      "second ask",
    );
  });

  test("one revision sent to two places is one lineage entry, not two", async () => {
    const source = new MockDraftsSource();
    const created = await source.create();
    await source.update({
      artifactId: created.id,
      baseVersion: created.version,
      body: "same ask, two agents",
    });
    await source.send({
      artifactId: created.id,
      target: { kind: "new_agent", workspaceId: "ws_main", provider: "claude" },
    });
    await source.send({
      artifactId: created.id,
      target: { kind: "existing_agent", agentId: "agt_b", workspaceId: "ws_torch" },
    });

    const artifact = await detail(source, created.id);
    expect(artifact.snapshots).toHaveLength(1);
    expect(artifact.dispatches).toHaveLength(2);

    // The editor groups lineage by revision, so this reads as one idea that
    // reached two places rather than as two separate ideas.
    const revisions = new Set(artifact.dispatches.map((entry) => entry.rev));
    expect(revisions.size).toBe(1);
  });

  test("a project-level plan is satisfied by a send into any workspace of it", async () => {
    const source = new MockDraftsSource();
    const created = await source.create({
      planned: [{ kind: "project", projectId: "prj_paseo" }],
    });
    await source.update({
      artifactId: created.id,
      baseVersion: created.version,
      body: "cut a worktree for this",
    });

    // Planned before the target workspace was chosen; sending into a sibling
    // settles it, because that is the case project-level planning exists for.
    expect(isPlannedFor(await detail(source, created.id), "ws_main", lookup)).toBe(true);
    await source.send({
      artifactId: created.id,
      target: { kind: "new_agent", workspaceId: "ws_neo", provider: "claude" },
    });
    expect(isPlannedFor(await detail(source, created.id), "ws_main", lookup)).toBe(false);
  });

  test("removing a plan takes the draft out of that workspace without touching history", async () => {
    const source = new MockDraftsSource();
    const created = await source.create({
      planned: [{ kind: "workspace", workspaceId: "ws_main" }],
    });
    await source.send({
      artifactId: created.id,
      target: { kind: "new_agent", workspaceId: "ws_main", provider: "claude" },
    });
    await source.update({
      artifactId: created.id,
      baseVersion: (await detail(source, created.id)).version,
      body: "edited after sending",
    });
    expect(isPlannedFor(await detail(source, created.id), "ws_main", lookup)).toBe(true);

    await source.setPlanned({ artifactId: created.id, planned: [] });
    const unplanned = await detail(source, created.id);
    expect(isPlannedFor(unplanned, "ws_main", lookup)).toBe(false);
    // The send still happened; unplanning is an intent change, not a rewrite.
    expect(dispatchesInto(unplanned, "ws_main", lookup)).toHaveLength(1);
  });
});
