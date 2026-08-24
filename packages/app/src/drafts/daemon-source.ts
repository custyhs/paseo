import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  ArtifactRecord,
  DispatchRecord,
  PlannedTarget as WirePlannedTarget,
} from "@getpaseo/protocol/draft/types";
import type {
  ArtifactDetail,
  ArtifactDispatch,
  ArtifactSnapshot,
  ArtifactSummary,
  PlannedTarget,
} from "./model";
import {
  DraftVersionConflictError,
  type DraftListQuery,
  type DraftsSource,
  type SendResult,
  type SendTarget,
} from "./source";

/**
 * `DraftsSource` over the daemon. The screens above it do not change; this
 * swaps in where `MockDraftsSource` used to be, once
 * `server_info.features.drafts` says the host has the domain.
 *
 * Two things here are not just plumbing:
 *
 * - A new draft does not exist on the daemon until it has something in it
 *   (ADR-0002). Ids are minted here, `create` sends no RPC, and the first
 *   non-empty save carries `baseVersion: 0`, which is the daemon's cue to
 *   create. Discarding an untouched draft is then a local non-event rather than
 *   a delete the sync layer would have to replicate.
 * - Sending is three steps, not one call (ADR-0003): capture the revision, make
 *   the ordinary `createAgent`/`sendMessage` call the rest of the app already
 *   makes, then settle. Choosing a provider is this side's business, which is
 *   the whole reason the middle step is not the daemon's.
 */

function toPlanned(target: WirePlannedTarget): PlannedTarget {
  // `projectKey` is dropped deliberately: it exists on the wire for a future
  // cross-host mapping and nothing in the UI reads it yet. Naming it here means
  // a protocol change surfaces as a type error rather than flowing through.
  return target.kind === "workspace"
    ? { kind: "workspace", workspaceId: target.workspaceId }
    : { kind: "project", projectId: target.projectId };
}

function toSummary(record: ArtifactRecord): ArtifactSummary {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    version: record.version,
    planned: record.planned.map(toPlanned),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt,
  };
}

function toDispatch(record: DispatchRecord): ArtifactDispatch {
  return {
    id: record.id,
    rev: record.rev,
    clientMessageId: record.clientMessageId,
    agentId: record.agentId,
    workspaceId: record.workspaceId,
    createdAt: record.createdAt,
    status: record.status,
    error: record.error,
  };
}

/** The dispatch log is append-only; the last line for an id is the current one. */
function foldDispatches(records: DispatchRecord[]): ArtifactDispatch[] {
  const byId = new Map<string, ArtifactDispatch>();
  for (const record of records) byId.set(record.id, toDispatch(record));
  return [...byId.values()];
}

/**
 * Minted here, not by the daemon. `crypto.randomUUID` is not there on every
 * platform the app runs on, so this falls back the way `workspace-layout-ids`
 * does — an id only has to be unique among this user's drafts.
 */
function newArtifactId(): string {
  const value =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `drf_${value.replaceAll("-", "")}`;
}

export interface DaemonDraftsSourceOptions {
  client: DaemonClient;
  /** Creates the agent for a `new_agent` send. The caller owns provider choice. */
  createAgent: (input: {
    target: Extract<SendTarget, { kind: "new_agent" }>;
    body: string;
    clientMessageId: string;
    labels: Record<string, string>;
  }) => Promise<{ agentId: string }>;
  sendToAgent: (input: { agentId: string; body: string; clientMessageId: string }) => Promise<void>;
}

export class DaemonDraftsSource implements DraftsSource {
  private readonly client: DaemonClient;
  private readonly options: DaemonDraftsSourceOptions;
  private readonly listeners = new Set<() => void>();
  /** Drafts that exist only here, because nobody has written in them yet. */
  private readonly unsaved = new Map<string, ArtifactDetail>();
  /** Snapshots never change, so one fetch per revision is the last one needed. */
  private readonly snapshots = new Map<string, ArtifactSnapshot>();
  private unsubscribe: (() => void) | null = null;

  constructor(options: DaemonDraftsSourceOptions) {
    this.client = options.client;
    this.options = options;
  }

  async list(query?: DraftListQuery): Promise<ArtifactSummary[]> {
    const records = await this.client.listDraftArtifacts({
      includeArchived: query?.includeArchived,
    });
    // The one you are typing in right now belongs in the list even though the
    // daemon has never heard of it.
    return [...records.map(toSummary), ...this.unsaved.values()];
  }

  async get(artifactId: string): Promise<ArtifactDetail | null> {
    const local = this.unsaved.get(artifactId);
    if (local) return local;
    const { artifact, dispatches } = await this.client.getDraftArtifact(artifactId);
    if (!artifact) return null;
    return { ...toSummary(artifact), snapshots: [], dispatches: foldDispatches(dispatches) };
  }

  async getSnapshot(input: { artifactId: string; rev: number }): Promise<ArtifactSnapshot | null> {
    const key = `${input.artifactId}@${input.rev}`;
    const cached = this.snapshots.get(key);
    if (cached) return cached;
    const snapshot = await this.client.getDraftSnapshot(input);
    if (!snapshot) return null;
    const entry: ArtifactSnapshot = {
      rev: snapshot.rev,
      createdAt: snapshot.createdAt,
      body: snapshot.body,
    };
    this.snapshots.set(key, entry);
    return entry;
  }

  /** Sends nothing. The draft becomes real on its first non-empty save. */
  create(input: { planned?: PlannedTarget[] } = {}): Promise<ArtifactDetail> {
    const timestamp = new Date().toISOString();
    const artifact: ArtifactDetail = {
      id: newArtifactId(),
      title: null,
      body: "",
      // Zero says "not yet on the daemon", and it is exactly the `baseVersion`
      // the first save has to carry.
      version: 0,
      planned: input.planned ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
      snapshots: [],
      dispatches: [],
    };
    this.unsaved.set(artifact.id, artifact);
    this.emit();
    return Promise.resolve(artifact);
  }

  async update(input: {
    artifactId: string;
    baseVersion: number;
    title?: string | null;
    body?: string;
  }): Promise<ArtifactDetail> {
    const pending = this.unsaved.get(input.artifactId);
    const { artifact, conflict } = await this.client.upsertDraftArtifact({
      artifactId: input.artifactId,
      baseVersion: input.baseVersion,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      // Only read on creation, and this is where a scratchpad draft's
      // pre-planned workspace finally reaches the disk.
      ...(pending && pending.planned.length > 0 ? { planned: pending.planned } : {}),
    });
    if (conflict) {
      throw new DraftVersionConflictError({
        artifactId: input.artifactId,
        actualVersion: conflict.version,
      });
    }
    if (!artifact) throw new Error(`Draft ${input.artifactId} was not saved`);
    this.unsaved.delete(input.artifactId);
    this.emit();
    return { ...toSummary(artifact), snapshots: [], dispatches: [] };
  }

  async setPlanned(input: {
    artifactId: string;
    planned: PlannedTarget[];
  }): Promise<ArtifactDetail> {
    const pending = this.unsaved.get(input.artifactId);
    if (pending) {
      // Nothing to plan against yet. Held here and sent with the first save.
      const next = { ...pending, planned: input.planned };
      this.unsaved.set(input.artifactId, next);
      this.emit();
      return next;
    }
    const artifact = await this.client.setDraftPlanned({
      artifactId: input.artifactId,
      planned: input.planned,
    });
    return { ...toSummary(artifact), snapshots: [], dispatches: [] };
  }

  async setArchived(input: { artifactId: string; archived: boolean }): Promise<ArtifactDetail> {
    const artifact = await this.client.setDraftArchived(input);
    return { ...toSummary(artifact), snapshots: [], dispatches: [] };
  }

  /** Only ever called for a draft nobody wrote in, which never left this map. */
  discard(artifactId: string): Promise<void> {
    if (this.unsaved.delete(artifactId)) this.emit();
    return Promise.resolve();
  }

  async send(input: { artifactId: string; target: SendTarget }): Promise<SendResult> {
    const { artifact, snapshot, dispatch } = await this.client.captureDraftRevision({
      artifactId: input.artifactId,
      // The wire target has no provider: which agent to run is decided here, so
      // the daemon has no use for it.
      target:
        input.target.kind === "new_agent"
          ? { kind: "new_agent", workspaceId: input.target.workspaceId }
          : input.target,
    });
    try {
      if (input.target.kind === "new_agent") {
        const { agentId } = await this.options.createAgent({
          target: input.target,
          // The snapshot, not the draft. Editing while the send is in flight
          // must not change what was sent.
          body: snapshot.body,
          clientMessageId: dispatch.clientMessageId,
          labels: {
            "paseo.draft.artifact": input.artifactId,
            "paseo.draft.rev": String(snapshot.rev),
          },
        });
        await this.client.settleDraftDispatch({
          artifactId: input.artifactId,
          dispatchId: dispatch.id,
          status: "sent",
          agentId,
        });
      } else {
        await this.options.sendToAgent({
          agentId: input.target.agentId,
          body: snapshot.body,
          clientMessageId: dispatch.clientMessageId,
        });
        await this.client.settleDraftDispatch({
          artifactId: input.artifactId,
          dispatchId: dispatch.id,
          status: "sent",
          agentId: input.target.agentId,
        });
      }
    } catch (error) {
      // The snapshot stays. It is what the user meant to send, and a failed send
      // is exactly when that is worth keeping.
      await this.client
        .settleDraftDispatch({
          artifactId: input.artifactId,
          dispatchId: dispatch.id,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined);
      throw error;
    }
    return {
      artifact: { ...toSummary(artifact), snapshots: [], dispatches: [] },
      dispatchId: dispatch.id,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.unsubscribe ??= this.client.on("draft.artifact_update", () => this.emit());
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;
      this.unsubscribe?.();
      this.unsubscribe = null;
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
