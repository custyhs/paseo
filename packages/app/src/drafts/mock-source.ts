import {
  samePlannedTarget,
  type ArtifactDetail,
  type ArtifactSnapshot,
  type ArtifactSummary,
  type PlannedTarget,
} from "./model";
import {
  DraftVersionConflictError,
  type DraftListQuery,
  type DraftsSource,
  type SendResult,
  type SendTarget,
} from "./source";

/**
 * In-memory `DraftsSource` for building the drafts UI before the daemon RPCs
 * exist. It is deliberately strict where the real store is strict — optimistic
 * concurrency really rejects stale writes, snapshots really are frozen once
 * captured — so the screens built against it exercise the same states.
 *
 * What it cannot fake: a real `agentId` from a real send, and surviving a
 * restart. Those are the feature's actual claims, and they only get proven
 * against the daemon.
 */

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}${counter.toString(16).padStart(6, "0")}`;
}

function summarize(artifact: ArtifactDetail): ArtifactSummary {
  const { snapshots: _snapshots, dispatches: _dispatches, ...summary } = artifact;
  return summary;
}

function matchesSearch(artifact: ArtifactDetail, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const haystack = `${artifact.title ?? ""}\n${artifact.body}`.toLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

export interface MockDraftsSourceOptions {
  seed?: ArtifactDetail[];
  /** Injected so tests get stable timestamps; production mock uses the wall clock. */
  now?: () => string;
}

export class MockDraftsSource implements DraftsSource {
  private readonly artifacts = new Map<string, ArtifactDetail>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => string;

  constructor(options: MockDraftsSourceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    for (const artifact of options.seed ?? []) {
      this.artifacts.set(artifact.id, structuredClone(artifact));
    }
  }

  async list(query: DraftListQuery = {}): Promise<ArtifactSummary[]> {
    const includeArchived = query.includeArchived ?? false;
    return [...this.artifacts.values()]
      .filter((artifact) => includeArchived || artifact.archivedAt === null)
      .filter((artifact) => {
        const filter = query.filter;
        if (!filter || filter.kind === "all") return true;
        return artifact.planned.some((target) => samePlannedTarget(target, filter.target));
      })
      .filter((artifact) => matchesSearch(artifact, query.search ?? ""))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(summarize);
  }

  async get(artifactId: string): Promise<ArtifactDetail | null> {
    const artifact = this.artifacts.get(artifactId);
    return artifact ? structuredClone(artifact) : null;
  }

  getSnapshot(input: { artifactId: string; rev: number }): Promise<ArtifactSnapshot | null> {
    const found = this.artifacts
      .get(input.artifactId)
      ?.snapshots.find((entry) => entry.rev === input.rev);
    return Promise.resolve(found ? structuredClone(found) : null);
  }

  async create(input: { planned?: PlannedTarget[] } = {}): Promise<ArtifactDetail> {
    const timestamp = this.now();
    const artifact: ArtifactDetail = {
      id: nextId("drf_"),
      title: null,
      body: "",
      version: 1,
      planned: input.planned ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
      snapshots: [],
      dispatches: [],
    };
    this.artifacts.set(artifact.id, artifact);
    this.emit();
    return structuredClone(artifact);
  }

  async update(input: {
    artifactId: string;
    baseVersion: number;
    title?: string | null;
    body?: string;
  }): Promise<ArtifactDetail> {
    const artifact = this.require(input.artifactId);
    if (artifact.version !== input.baseVersion) {
      throw new DraftVersionConflictError({
        artifactId: input.artifactId,
        actualVersion: artifact.version,
      });
    }
    if (input.title !== undefined) artifact.title = input.title;
    if (input.body !== undefined) artifact.body = input.body;
    artifact.version += 1;
    artifact.updatedAt = this.now();
    this.emit();
    return structuredClone(artifact);
  }

  async setPlanned(input: {
    artifactId: string;
    planned: PlannedTarget[];
  }): Promise<ArtifactDetail> {
    const artifact = this.require(input.artifactId);
    artifact.planned = [...input.planned];
    artifact.version += 1;
    artifact.updatedAt = this.now();
    this.emit();
    return structuredClone(artifact);
  }

  async setArchived(input: { artifactId: string; archived: boolean }): Promise<ArtifactDetail> {
    const artifact = this.require(input.artifactId);
    const timestamp = this.now();
    artifact.archivedAt = input.archived ? timestamp : null;
    artifact.version += 1;
    artifact.updatedAt = timestamp;
    this.emit();
    return structuredClone(artifact);
  }

  async discard(artifactId: string): Promise<void> {
    this.artifacts.delete(artifactId);
    this.emit();
  }

  async send(input: { artifactId: string; target: SendTarget }): Promise<SendResult> {
    const artifact = this.require(input.artifactId);
    const timestamp = this.now();

    // Capturing the same revision twice must not produce a second snapshot, and
    // must never rewrite the first — that is the whole point of a snapshot.
    if (!artifact.snapshots.some((snapshot) => snapshot.rev === artifact.version)) {
      artifact.snapshots.push({
        rev: artifact.version,
        createdAt: timestamp,
        body: artifact.body,
      });
    }

    const dispatch = {
      id: nextId("dsp_"),
      rev: artifact.version,
      clientMessageId: nextId("cmid_"),
      agentId: input.target.kind === "existing_agent" ? input.target.agentId : null,
      workspaceId: input.target.workspaceId,
      createdAt: timestamp,
      status: "sent" as const,
      error: null,
    };
    artifact.dispatches.push(dispatch);
    artifact.updatedAt = timestamp;
    this.emit();
    return { artifact: structuredClone(artifact), dispatchId: dispatch.id };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private require(artifactId: string): ArtifactDetail {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) throw new Error(`Draft ${artifactId} not found`);
    return artifact;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
