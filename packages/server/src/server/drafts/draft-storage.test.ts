import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ArtifactVersionConflictError } from "./draft-model.js";
import { DraftStorage } from "./draft-storage.js";

const silentLogger = { warn: () => undefined };

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(tmpdir(), "paseo-drafts-"));
});
afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

function newStore() {
  return new DraftStorage(baseDir, silentLogger);
}

/** Restarting the daemon means a fresh store over the same directory. */
async function reopen() {
  const store = newStore();
  await store.initialize();
  return store;
}

describe("artifact persistence", () => {
  test("an untitled, unscoped draft survives a restart byte for byte", async () => {
    const store = newStore();
    const created = await store.create();
    expect(created.title).toBeNull();
    expect(created.planned).toEqual([]);

    const body =
      "下一阶段:把 parser 改成增量式。\n\n- 不要动 AST 节点形状\n- 复用 dirty-range tracker";
    await store.update({ id: created.id, baseVersion: created.version, body });
    await store.flush();

    const restarted = await reopen();
    const loaded = await restarted.get(created.id);
    expect(loaded?.body).toBe(body);
    expect(loaded?.version).toBe(2);
  });

  test("version is monotonic across edits", async () => {
    const store = newStore();
    const created = await store.create();
    let version = created.version;
    for (const text of ["a", "ab", "abc"]) {
      const next = await store.update({ id: created.id, baseVersion: version, body: text });
      expect(next.version).toBe(version + 1);
      version = next.version;
    }
  });

  test("a stale baseVersion is refused and reports the current version", async () => {
    const store = newStore();
    const created = await store.create();
    await store.update({ id: created.id, baseVersion: created.version, body: "first" });

    await expect(
      store.update({ id: created.id, baseVersion: created.version, body: "racing write" }),
    ).rejects.toBeInstanceOf(ArtifactVersionConflictError);

    const current = await store.get(created.id);
    expect(current?.body).toBe("first");
  });

  test("a burst of autosaves lands in order without tearing the record", async () => {
    const store = newStore();
    const created = await store.create();

    // Sequential awaits mirror the composer's debounce; the point is that the
    // queue keeps the file consistent rather than interleaving partial writes.
    let version = created.version;
    for (let index = 0; index < 20; index += 1) {
      const next = await store.update({
        id: created.id,
        baseVersion: version,
        body: `edit-${index}`,
      });
      version = next.version;
    }
    await store.flush();

    const restarted = await reopen();
    const loaded = await restarted.get(created.id);
    expect(loaded?.body).toBe("edit-19");
    expect(loaded?.version).toBe(21);
  });

  test("archiving keeps the record and unarchiving clears the stamp", async () => {
    const store = newStore();
    const created = await store.create({ body: "keep me" });
    await store.setArchived({ id: created.id, archived: true });
    expect((await store.list()).map((entry) => entry.id)).not.toContain(created.id);
    expect((await store.list({ includeArchived: true })).map((entry) => entry.id)).toContain(
      created.id,
    );

    await store.setArchived({ id: created.id, archived: false });
    const reopened = await store.get(created.id);
    expect(reopened?.archivedAt).toBeNull();
    expect(reopened?.body).toBe("keep me");
  });
});

describe("INV-A — snapshots are immutable", () => {
  test("editing the artifact never changes an existing snapshot", async () => {
    const store = newStore();
    const created = await store.create({ body: "revision one" });
    const snapshot = await store.captureSnapshot({ artifactId: created.id });
    expect(snapshot.rev).toBe(created.version);

    await store.update({ id: created.id, baseVersion: created.version, body: "revision two" });
    await store.flush();

    const detail = await store.get(created.id);
    expect(detail?.body).toBe("revision two");
    expect(detail?.snapshots.find((entry) => entry.rev === snapshot.rev)?.body).toBe(
      "revision one",
    );

    const restarted = await reopen();
    const afterRestart = await restarted.get(created.id);
    expect(afterRestart?.snapshots.find((entry) => entry.rev === snapshot.rev)?.body).toBe(
      "revision one",
    );
  });

  test("capturing the same revision twice returns the original bytes", async () => {
    const store = newStore();
    const created = await store.create({ body: "original" });
    const first = await store.captureSnapshot({ artifactId: created.id });

    // Simulate a caller that mutated the cache-visible body without bumping the
    // version — the snapshot must not be rewritten regardless.
    const second = await store.captureSnapshot({ artifactId: created.id });
    expect(second.body).toBe(first.body);
    expect(second.createdAt).toBe(first.createdAt);

    await store.flush();
    const files = await fs.readdir(path.join(baseDir, created.id, "snapshots"));
    expect(files).toEqual(["0001.json"]);
  });

  test("snapshot files are zero padded so a directory listing sorts by revision", async () => {
    const store = newStore();
    const created = await store.create({ body: "v1" });
    let version = created.version;
    await store.captureSnapshot({ artifactId: created.id });
    for (let index = 0; index < 11; index += 1) {
      const next = await store.update({ id: created.id, baseVersion: version, body: `v${index}` });
      version = next.version;
    }
    await store.captureSnapshot({ artifactId: created.id });
    await store.flush();

    const files = (await fs.readdir(path.join(baseDir, created.id, "snapshots"))).sort();
    expect(files).toEqual(["0001.json", "0012.json"]);
  });
});

describe("INV-B — dispatch lineage", () => {
  test("a dispatch carries the client message id and gains the agent id when it settles", async () => {
    const store = newStore();
    const created = await store.create({ body: "send me" });
    const snapshot = await store.captureSnapshot({ artifactId: created.id });

    const pending = await store.recordDispatch({
      artifactId: created.id,
      rev: snapshot.rev,
      clientMessageId: "cmid_9f21",
      workspaceId: "wks_main",
    });
    expect(pending.status).toBe("pending");
    expect(pending.agentId).toBeNull();

    await store.settleDispatch({
      artifactId: created.id,
      dispatchId: pending.id,
      status: "sent",
      agentId: "agt_a2",
    });
    await store.flush();

    const restarted = await reopen();
    const detail = await restarted.get(created.id);
    expect(detail?.dispatches).toHaveLength(1);
    expect(detail?.dispatches[0]).toMatchObject({
      clientMessageId: "cmid_9f21",
      agentId: "agt_a2",
      status: "sent",
      rev: snapshot.rev,
    });
  });

  test("a failed send keeps the snapshot and records the failure", async () => {
    const store = newStore();
    const created = await store.create({ body: "will fail" });
    const snapshot = await store.captureSnapshot({ artifactId: created.id });
    const pending = await store.recordDispatch({
      artifactId: created.id,
      rev: snapshot.rev,
      clientMessageId: "cmid_dead",
    });
    await store.settleDispatch({
      artifactId: created.id,
      dispatchId: pending.id,
      status: "failed",
      error: "provider unavailable",
    });
    await store.flush();

    const detail = await (await reopen()).get(created.id);
    expect(detail?.snapshots.find((entry) => entry.rev === snapshot.rev)?.body).toBe("will fail");
    expect(detail?.dispatches[0]).toMatchObject({
      status: "failed",
      error: "provider unavailable",
    });
  });

  test("retrying after a failure does not corrupt the earlier dispatch history", async () => {
    const store = newStore();
    const created = await store.create({ body: "retry me" });
    const snapshot = await store.captureSnapshot({ artifactId: created.id });

    const first = await store.recordDispatch({
      artifactId: created.id,
      rev: snapshot.rev,
      clientMessageId: "cmid_1",
    });
    await store.settleDispatch({
      artifactId: created.id,
      dispatchId: first.id,
      status: "failed",
      error: "boom",
    });
    const retry = await store.recordDispatch({
      artifactId: created.id,
      rev: snapshot.rev,
      clientMessageId: "cmid_2",
    });
    await store.settleDispatch({
      artifactId: created.id,
      dispatchId: retry.id,
      status: "sent",
      agentId: "agt_new",
    });
    await store.flush();

    const detail = await (await reopen()).get(created.id);
    expect(detail?.dispatches).toHaveLength(2);
    expect(detail?.dispatches.find((entry) => entry.id === first.id)).toMatchObject({
      status: "failed",
      error: "boom",
    });
    expect(detail?.dispatches.find((entry) => entry.id === retry.id)).toMatchObject({
      status: "sent",
      agentId: "agt_new",
    });
  });

  test("a truncated final line is dropped without losing the rest of the lineage", async () => {
    const store = newStore();
    const created = await store.create({ body: "partial write" });
    const snapshot = await store.captureSnapshot({ artifactId: created.id });
    const good = await store.recordDispatch({
      artifactId: created.id,
      rev: snapshot.rev,
      clientMessageId: "cmid_good",
    });
    await store.flush();

    const file = path.join(baseDir, created.id, "dispatches.jsonl");
    await fs.appendFile(file, '{"id":"half","rev":1,"clientMess', "utf8");

    const detail = await (await reopen()).get(created.id);
    expect(detail?.dispatches).toHaveLength(1);
    expect(detail?.dispatches[0]?.id).toBe(good.id);
  });
});

describe("INV-C — many to many", () => {
  test("one artifact produces several sent revisions to different agents", async () => {
    const store = newStore();
    const created = await store.create({ body: "rev one" });
    const first = await store.captureSnapshot({ artifactId: created.id });
    const d1 = await store.recordDispatch({
      artifactId: created.id,
      rev: first.rev,
      clientMessageId: "cmid_a",
    });
    await store.settleDispatch({
      artifactId: created.id,
      dispatchId: d1.id,
      status: "sent",
      agentId: "agt_claude",
    });

    const edited = await store.update({
      id: created.id,
      baseVersion: created.version,
      body: "rev two",
    });
    const second = await store.captureSnapshot({ artifactId: created.id });
    expect(second.rev).toBe(edited.version);

    const d2 = await store.recordDispatch({
      artifactId: created.id,
      rev: second.rev,
      clientMessageId: "cmid_b",
    });
    await store.settleDispatch({
      artifactId: created.id,
      dispatchId: d2.id,
      status: "sent",
      agentId: "agt_codex",
    });
    await store.flush();

    const detail = await (await reopen()).get(created.id);
    expect(detail?.snapshots.map((entry) => entry.body)).toEqual(["rev one", "rev two"]);
    expect(detail?.dispatches.map((entry) => entry.agentId)).toEqual(["agt_claude", "agt_codex"]);
  });

  test("the same agent can receive several revisions of one artifact", async () => {
    const store = newStore();
    const created = await store.create({ body: "first ask" });
    const first = await store.captureSnapshot({ artifactId: created.id });
    const d1 = await store.recordDispatch({
      artifactId: created.id,
      rev: first.rev,
      clientMessageId: "cmid_1",
      agentId: "agt_same",
      status: "sent",
    });
    const edited = await store.update({
      id: created.id,
      baseVersion: created.version,
      body: "follow up",
    });
    const second = await store.captureSnapshot({ artifactId: created.id });
    const d2 = await store.recordDispatch({
      artifactId: created.id,
      rev: second.rev,
      clientMessageId: "cmid_2",
      agentId: "agt_same",
      status: "sent",
    });
    await store.flush();

    const detail = await (await reopen()).get(created.id);
    expect(detail?.dispatches.map((entry) => entry.id)).toEqual([d1.id, d2.id]);
    expect(new Set(detail?.dispatches.map((entry) => entry.agentId))).toEqual(
      new Set(["agt_same"]),
    );
    expect(detail?.dispatches.map((entry) => entry.rev)).toEqual([first.rev, second.rev]);
    expect(edited.version).toBe(second.rev);
  });
});

describe("sync-friendly layout", () => {
  test("an edit rewrites only artifact.json and leaves snapshots untouched", async () => {
    const store = newStore();
    const created = await store.create({ body: "one" });
    await store.captureSnapshot({ artifactId: created.id });
    await store.flush();

    const snapshotPath = path.join(baseDir, created.id, "snapshots", "0001.json");
    const before = await fs.stat(snapshotPath);

    await store.update({ id: created.id, baseVersion: created.version, body: "two" });
    await store.flush();

    const after = await fs.stat(snapshotPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
  });

  test("no index file is persisted alongside the per-draft directories", async () => {
    const store = newStore();
    await store.create({ body: "a" });
    await store.create({ body: "b" });
    await store.flush();

    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    expect(entries.every((entry) => entry.isDirectory())).toBe(true);
    expect(entries.every((entry) => entry.name.startsWith("drf_"))).toBe(true);
  });

  test("atomic writes leave no temp files behind", async () => {
    const store = newStore();
    const created = await store.create({ body: "x" });
    await store.update({ id: created.id, baseVersion: created.version, body: "y" });
    await store.flush();

    const entries = await fs.readdir(path.join(baseDir, created.id));
    expect(entries.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
