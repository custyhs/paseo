import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonFileAtomic } from "../atomic-file.js";
import {
  ARTIFACT_ID_PREFIX,
  ArtifactNotFoundError,
  ArtifactRecordSchema,
  ArtifactVersionConflictError,
  DispatchRecordSchema,
  SnapshotRecordSchema,
  parseSnapshotFileName,
  snapshotFileName,
  type ArtifactDetail,
  type ArtifactRecord,
  type DispatchRecord,
  type DispatchStatus,
  type PlannedTarget,
  type SnapshotRecord,
} from "./draft-model.js";

/**
 * File-backed store for durable prompt drafts, mirroring `AgentStorage`: Zod at
 * the boundary, a memory cache, one directory per record, atomic writes, and
 * per-record write serialization so callers never coordinate raw reads and
 * writes themselves (`docs/data-model.md`).
 *
 * Layout — the split exists for incremental sync, not for tidiness:
 *
 *   drafts/<artifactId>/
 *     artifact.json          mutable, small; the only file an edit rewrites
 *     snapshots/0017.json    immutable; written once, then never touched again
 *     dispatches.jsonl       append-only
 *
 * No index file is persisted. One would be rewritten on every edit, which is
 * exactly the "re-send everything" behaviour the layout exists to avoid; the
 * search projection is rebuilt in memory at boot instead.
 */

interface Logger {
  warn(payload: unknown, message?: string): void;
}

const ARTIFACT_FILE = "artifact.json";
const SNAPSHOT_DIR = "snapshots";
const DISPATCH_FILE = "dispatches.jsonl";

/**
 * Told about every write, so each connected session can push the record on to
 * its own client. One artifact per notification: the client holds a full replica
 * and applies these the way it applies `workspace_update`.
 */
export type DraftChangeListener = (change: {
  artifact: ArtifactRecord;
  dispatches?: DispatchRecord[];
}) => void;

export interface CreateArtifactInput {
  title?: string | null;
  body?: string;
  planned?: PlannedTarget[];
  now?: string;
}

export interface UpdateArtifactInput {
  id: string;
  baseVersion: number;
  title?: string | null;
  body?: string;
  now?: string;
}

export interface SetPlannedInput {
  id: string;
  planned: PlannedTarget[];
  baseVersion?: number;
  now?: string;
}

export interface RecordDispatchInput {
  artifactId: string;
  rev: number;
  clientMessageId: string;
  agentId?: string | null;
  workspaceId?: string | null;
  status?: DispatchStatus;
  error?: string | null;
  now?: string;
}

export class DraftStorage {
  private readonly baseDir: string;
  private readonly logger: Logger;
  private readonly artifacts = new Map<string, ArtifactRecord>();
  private readonly snapshots = new Map<string, Map<number, SnapshotRecord>>();
  private readonly dispatches = new Map<string, DispatchRecord[]>();
  private readonly pendingWrites = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<DraftChangeListener>();
  private loadPromise: Promise<void> | null = null;

  constructor(baseDir: string, logger: Logger) {
    this.baseDir = baseDir;
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    await this.load();
  }

  onChange(listener: DraftChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Lineage changed but the record did not; push both so clients stay whole. */
  private notifyDispatch(artifactId: string): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return;
    this.notify(artifact, [...(this.dispatches.get(artifactId) ?? [])]);
  }

  private notify(artifact: ArtifactRecord, dispatches?: DispatchRecord[]): void {
    for (const listener of this.listeners) {
      try {
        listener({ artifact, dispatches });
      } catch (error) {
        // One session's emit failing must not stop the others from hearing.
        this.logger.warn({ error, artifactId: artifact.id }, "Draft change listener failed");
      }
    }
  }

  // ── reads ────────────────────────────────────────────────────────────────

  async list(options?: { includeArchived?: boolean }): Promise<ArtifactRecord[]> {
    await this.load();
    const includeArchived = options?.includeArchived ?? false;
    return [...this.artifacts.values()]
      .filter((record) => includeArchived || record.archivedAt === null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(artifactId: string): Promise<ArtifactDetail | null> {
    await this.load();
    const record = this.artifacts.get(artifactId);
    if (!record) return null;
    return {
      ...record,
      snapshots: [...(this.snapshots.get(artifactId)?.values() ?? [])].sort(
        (left, right) => left.rev - right.rev,
      ),
      dispatches: [...(this.dispatches.get(artifactId) ?? [])],
    };
  }

  // ── writes ───────────────────────────────────────────────────────────────

  /**
   * A draft may be created with nothing at all: no title, no body, no scope.
   * That is the product's first requirement, so it is the store's default.
   */
  async create(input: CreateArtifactInput = {}): Promise<ArtifactRecord> {
    await this.load();
    const now = input.now ?? new Date().toISOString();
    const record: ArtifactRecord = {
      id: `${ARTIFACT_ID_PREFIX}${randomBytes(8).toString("hex")}`,
      title: input.title ?? null,
      body: input.body ?? "",
      version: 1,
      planned: input.planned ?? [],
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    await this.queue(record.id, async () => {
      await this.writeArtifact(record);
    });
    this.notify(record);
    return record;
  }

  /**
   * Creates the record when it is not there yet, which is how a client-minted id
   * first reaches the disk: a draft nobody wrote in never gets created at all,
   * so discarding one is a non-event rather than a delete the sync layer has to
   * carry. `baseVersion: 0` is the caller saying "this is a creation".
   */
  async upsert(input: {
    id: string;
    baseVersion: number;
    title?: string | null;
    body?: string;
    planned?: PlannedTarget[];
    now?: string;
  }): Promise<ArtifactRecord> {
    await this.load();
    if (this.artifacts.has(input.id)) {
      return this.update({
        id: input.id,
        baseVersion: input.baseVersion,
        title: input.title,
        body: input.body,
        now: input.now,
      });
    }
    if (input.baseVersion !== 0) {
      throw new ArtifactVersionConflictError({
        artifactId: input.id,
        expectedVersion: input.baseVersion,
        actualVersion: 0,
      });
    }
    const now = input.now ?? new Date().toISOString();
    const record: ArtifactRecord = {
      id: input.id,
      title: input.title ?? null,
      body: input.body ?? "",
      version: 1,
      planned: input.planned ?? [],
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    await this.queue(record.id, async () => {
      await this.writeArtifact(record);
    });
    this.notify(record);
    return record;
  }

  async update(input: UpdateArtifactInput): Promise<ArtifactRecord> {
    return this.mutate(input.id, input.baseVersion, (current) => ({
      ...current,
      title: input.title !== undefined ? input.title : current.title,
      body: input.body !== undefined ? input.body : current.body,
      updatedAt: input.now ?? new Date().toISOString(),
    }));
  }

  async setPlanned(input: SetPlannedInput): Promise<ArtifactRecord> {
    return this.mutate(input.id, input.baseVersion, (current) => ({
      ...current,
      planned: input.planned,
      updatedAt: input.now ?? new Date().toISOString(),
    }));
  }

  async setArchived(input: {
    id: string;
    archived: boolean;
    now?: string;
  }): Promise<ArtifactRecord> {
    return this.mutate(input.id, undefined, (current) => ({
      ...current,
      archivedAt: input.archived ? (input.now ?? new Date().toISOString()) : null,
      updatedAt: input.now ?? new Date().toISOString(),
    }));
  }

  /**
   * Captures the current body as revision `version`. Idempotent: asking twice
   * for the same revision returns the snapshot already on disk rather than
   * rewriting it, because a rewritten snapshot would break both the immutability
   * guarantee and the sync layout that depends on it.
   */
  async captureSnapshot(input: { artifactId: string; now?: string }): Promise<SnapshotRecord> {
    await this.load();
    const record = this.artifacts.get(input.artifactId);
    if (!record) throw new ArtifactNotFoundError(input.artifactId);

    const existing = this.snapshots.get(input.artifactId)?.get(record.version);
    if (existing) return existing;

    const snapshot: SnapshotRecord = {
      rev: record.version,
      createdAt: input.now ?? new Date().toISOString(),
      body: record.body,
    };
    await this.queue(input.artifactId, async () => {
      const already = this.snapshots.get(input.artifactId)?.get(snapshot.rev);
      if (already) return;
      await writeJsonFileAtomic(
        path.join(this.dirFor(input.artifactId), SNAPSHOT_DIR, snapshotFileName(snapshot.rev)),
        snapshot,
      );
      this.indexSnapshot(input.artifactId, snapshot);
    });
    return this.snapshots.get(input.artifactId)?.get(snapshot.rev) ?? snapshot;
  }

  /** Appends one line. A dispatch is never rewritten; it is superseded by `settleDispatch`. */
  async recordDispatch(input: RecordDispatchInput): Promise<DispatchRecord> {
    await this.load();
    if (!this.artifacts.has(input.artifactId)) throw new ArtifactNotFoundError(input.artifactId);
    const dispatch: DispatchRecord = {
      id: randomUUID(),
      rev: input.rev,
      clientMessageId: input.clientMessageId,
      agentId: input.agentId ?? null,
      workspaceId: input.workspaceId ?? null,
      createdAt: input.now ?? new Date().toISOString(),
      status: input.status ?? "pending",
      error: input.error ?? null,
    };
    await this.queue(input.artifactId, async () => {
      await this.appendDispatch(input.artifactId, dispatch);
    });
    this.notifyDispatch(input.artifactId);
    return dispatch;
  }

  /**
   * Completes a pending dispatch by appending its resolved form. The log keeps
   * both lines; the resolved one wins on read. Appending rather than editing is
   * what keeps the file cheap to sync and impossible to corrupt mid-write.
   */
  async settleDispatch(input: {
    artifactId: string;
    dispatchId: string;
    status: DispatchStatus;
    agentId?: string | null;
    error?: string | null;
    now?: string;
  }): Promise<DispatchRecord> {
    await this.load();
    const current = (this.dispatches.get(input.artifactId) ?? []).find(
      (entry) => entry.id === input.dispatchId,
    );
    if (!current) {
      throw new Error(`Dispatch ${input.dispatchId} not found on draft ${input.artifactId}`);
    }
    const settled: DispatchRecord = {
      ...current,
      status: input.status,
      agentId: input.agentId !== undefined ? input.agentId : current.agentId,
      error: input.error !== undefined ? input.error : current.error,
    };
    await this.queue(input.artifactId, async () => {
      await this.appendDispatch(input.artifactId, settled);
    });
    this.notifyDispatch(input.artifactId);
    return settled;
  }

  /** Waits for every queued write. Tests and shutdown use it; nothing else should need to. */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pendingWrites.values());
  }

  // ── internals ────────────────────────────────────────────────────────────

  private dirFor(artifactId: string): string {
    return path.join(this.baseDir, artifactId);
  }

  private async mutate(
    artifactId: string,
    baseVersion: number | undefined,
    apply: (current: ArtifactRecord) => ArtifactRecord,
  ): Promise<ArtifactRecord> {
    await this.load();
    let result: ArtifactRecord | null = null;
    await this.queue(artifactId, async () => {
      const current = this.artifacts.get(artifactId);
      if (!current) throw new ArtifactNotFoundError(artifactId);
      if (baseVersion !== undefined && baseVersion !== current.version) {
        throw new ArtifactVersionConflictError({
          artifactId,
          expectedVersion: baseVersion,
          actualVersion: current.version,
        });
      }
      const next = { ...apply(current), version: current.version + 1 };
      await this.writeArtifact(next);
      result = next;
    });
    if (!result) throw new ArtifactNotFoundError(artifactId);
    this.notify(result);
    return result;
  }

  /**
   * Serializes writes per artifact the way `AgentStorage` does, so a burst of
   * autosaves can never interleave into a torn record. Rejections propagate to
   * the caller but must not poison the chain for the next write.
   */
  private queue<T>(artifactId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.pendingWrites.get(artifactId) ?? Promise.resolve();
    const next = previous.then(run, run);
    const tracked = next
      .catch(() => undefined)
      .finally(() => {
        if (this.pendingWrites.get(artifactId) === tracked) {
          this.pendingWrites.delete(artifactId);
        }
      });
    this.pendingWrites.set(artifactId, tracked);
    return next;
  }

  private async writeArtifact(record: ArtifactRecord): Promise<void> {
    await writeJsonFileAtomic(path.join(this.dirFor(record.id), ARTIFACT_FILE), record);
    this.artifacts.set(record.id, record);
  }

  private async appendDispatch(artifactId: string, dispatch: DispatchRecord): Promise<void> {
    const file = path.join(this.dirFor(artifactId), DISPATCH_FILE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(dispatch)}\n`, "utf8");
    this.indexDispatch(artifactId, dispatch);
  }

  private indexSnapshot(artifactId: string, snapshot: SnapshotRecord): void {
    let bucket = this.snapshots.get(artifactId);
    if (!bucket) {
      bucket = new Map();
      this.snapshots.set(artifactId, bucket);
    }
    // First write wins: a snapshot is immutable, so a second one for the same
    // revision is a bug upstream and must not overwrite the original bytes.
    if (!bucket.has(snapshot.rev)) bucket.set(snapshot.rev, snapshot);
  }

  private indexDispatch(artifactId: string, dispatch: DispatchRecord): void {
    const bucket = this.dispatches.get(artifactId) ?? [];
    const at = bucket.findIndex((entry) => entry.id === dispatch.id);
    if (at >= 0) bucket[at] = dispatch;
    else bucket.push(dispatch);
    this.dispatches.set(artifactId, bucket);
  }

  private load(): Promise<void> {
    this.loadPromise ??= this.readAll();
    return this.loadPromise;
  }

  private async readAll(): Promise<void> {
    let entries: string[];
    try {
      entries = (await fs.readdir(this.baseDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(ARTIFACT_ID_PREFIX))
        .map((entry) => entry.name);
    } catch (error) {
      // Absence is the first run: creating a draft makes the directory. Any
      // other reason — not a directory, no permission — means the drafts on
      // disk cannot be read, and reporting that as an empty store would show
      // the user an empty list where their work should be. `bootstrap` catches
      // this and stops advertising the capability, so the client says the host
      // does not support drafts instead of implying there are none.
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return;
      throw error;
    }

    for (const id of entries) {
      const record = await this.readArtifact(id);
      if (!record) continue;
      this.artifacts.set(record.id, record);
      await this.readSnapshots(id);
      await this.readDispatches(id);
    }
  }

  private async readArtifact(id: string): Promise<ArtifactRecord | null> {
    const file = path.join(this.dirFor(id), ARTIFACT_FILE);
    try {
      const parsed = ArtifactRecordSchema.safeParse(JSON.parse(await fs.readFile(file, "utf8")));
      if (parsed.success) return parsed.data;
      this.logger.warn({ file, issues: parsed.error.issues }, "Skipping unreadable draft record");
    } catch (error) {
      this.logger.warn({ file, error }, "Skipping unreadable draft record");
    }
    return null;
  }

  private async readSnapshots(id: string): Promise<void> {
    const dir = path.join(this.dirFor(id), SNAPSHOT_DIR);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const rev = parseSnapshotFileName(name);
      if (rev === null) continue;
      try {
        const parsed = SnapshotRecordSchema.safeParse(
          JSON.parse(await fs.readFile(path.join(dir, name), "utf8")),
        );
        if (parsed.success) this.indexSnapshot(id, parsed.data);
        else this.logger.warn({ id, name }, "Skipping unreadable draft snapshot");
      } catch (error) {
        this.logger.warn({ id, name, error }, "Skipping unreadable draft snapshot");
      }
    }
  }

  /**
   * A crash can leave a half-written final line. Dropping it loses at most the
   * dispatch that was in flight; refusing to parse the file would lose the whole
   * lineage, which is far worse.
   */
  private async readDispatches(id: string): Promise<void> {
    const file = path.join(this.dirFor(id), DISPATCH_FILE);
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      return;
    }
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    for (const [index, line] of lines.entries()) {
      try {
        const parsed = DispatchRecordSchema.safeParse(JSON.parse(line));
        if (parsed.success) {
          this.indexDispatch(id, parsed.data);
          continue;
        }
        this.logger.warn({ id, line: index }, "Skipping unreadable dispatch line");
      } catch (error) {
        if (index === lines.length - 1) {
          this.logger.warn({ id }, "Dropping truncated final dispatch line");
        } else {
          this.logger.warn({ id, line: index, error }, "Skipping unreadable dispatch line");
        }
      }
    }
  }
}
