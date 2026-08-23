import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  ArtifactNotFoundError,
  ArtifactVersionConflictError,
  type ArtifactRecord,
} from "../../drafts/draft-model.js";
import type { DraftStorage } from "../../drafts/draft-storage.js";

/**
 * The `draft.*` domain. Everything the session needs to know about drafts is
 * behind this one object: `session.ts` gets an import, a field, a constructor
 * line and one entry in the dispatch chain, and no `case` of its own. The file
 * is the most-edited in the server — 353 changes in half a year — so the less of
 * this that lives there, the less of it a rebase has to survive.
 */

type DraftInbound = Extract<SessionInboundMessage, { type: `draft.${string}` }>;

export interface DraftSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface DraftSessionOptions {
  host: DraftSessionHost;
  /** Absent when the daemon could not open the store; drafts are then off. */
  storage: DraftStorage | undefined;
  logger: pino.Logger;
}

export class DraftSession {
  private readonly host: DraftSessionHost;
  private readonly storage: DraftStorage | undefined;
  private readonly logger: pino.Logger;
  private unsubscribe: (() => void) | null = null;

  constructor(options: DraftSessionOptions) {
    this.host = options.host;
    this.storage = options.storage;
    this.logger = options.logger;
  }

  /**
   * Pushes every write to this client, including this client's own. The record
   * a client gets back from its own RPC and the record it gets from the push are
   * the same bytes, so applying both is idempotent — and not filtering means one
   * code path instead of two.
   */
  start(): void {
    if (!this.storage) return;
    this.unsubscribe ??= this.storage.onChange(({ artifact, dispatches }) => {
      this.host.emit({
        type: "draft.artifact_update",
        payload: { kind: "upsert", artifact, ...(dispatches ? { dispatches } : {}) },
      });
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Returns undefined for anything that is not ours, so the chain moves on. */
  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    const storage = this.storage;
    if (!storage || !msg.type.startsWith("draft.")) return undefined;
    const request = msg as DraftInbound;
    switch (request.type) {
      case "draft.list_artifacts.request":
        return this.handleList(storage, request);
      case "draft.get_artifact.request":
        return this.handleGet(storage, request);
      case "draft.upsert_artifact.request":
        return this.handleUpsert(storage, request);
      case "draft.set_planned.request":
        return this.handleSetPlanned(storage, request);
      case "draft.set_archived.request":
        return this.handleSetArchived(storage, request);
      case "draft.get_snapshot.request":
        return this.handleGetSnapshot(storage, request);
      default:
        return undefined;
    }
  }

  private async handleList(
    storage: DraftStorage,
    request: Extract<DraftInbound, { type: "draft.list_artifacts.request" }>,
  ): Promise<void> {
    try {
      const artifacts = await storage.list({ includeArchived: request.includeArchived });
      this.host.emit({
        type: "draft.list_artifacts.response",
        payload: { requestId: request.requestId, artifacts },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  private async handleGet(
    storage: DraftStorage,
    request: Extract<DraftInbound, { type: "draft.get_artifact.request" }>,
  ): Promise<void> {
    try {
      const detail = await storage.get(request.artifactId);
      // Snapshots are pulled one at a time by `draft.get_snapshot`; a draft sent
      // twenty times is twenty copies of its body, and they are only read when
      // someone opens that row of the lineage.
      const { artifact, dispatches } = detail
        ? { artifact: toRecord(detail), dispatches: detail.dispatches }
        : { artifact: null, dispatches: [] };
      this.host.emit({
        type: "draft.get_artifact.response",
        payload: { requestId: request.requestId, artifact, dispatches },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  private async handleUpsert(
    storage: DraftStorage,
    request: Extract<DraftInbound, { type: "draft.upsert_artifact.request" }>,
  ): Promise<void> {
    try {
      const artifact = await storage.upsert({
        id: request.artifactId,
        baseVersion: request.baseVersion,
        title: request.title,
        body: request.body,
        planned: request.planned,
      });
      this.host.emit({
        type: "draft.upsert_artifact.response",
        payload: { requestId: request.requestId, artifact, conflict: null, error: null },
      });
    } catch (error) {
      // A stale write is not an error channel event. The current record comes
      // back so the client can offer reload-or-overwrite without a second round
      // trip, and overwrite is this same request again with the version it was
      // just shown.
      if (error instanceof ArtifactVersionConflictError) {
        const current = await storage.get(request.artifactId);
        this.host.emit({
          type: "draft.upsert_artifact.response",
          payload: {
            requestId: request.requestId,
            artifact: current ? toRecord(current) : null,
            conflict: current ? toRecord(current) : null,
            error: null,
          },
        });
        return;
      }
      this.emitRpcError(request, error);
    }
  }

  private async handleSetPlanned(
    storage: DraftStorage,
    request: Extract<DraftInbound, { type: "draft.set_planned.request" }>,
  ): Promise<void> {
    try {
      const artifact = await storage.setPlanned({
        id: request.artifactId,
        planned: request.planned,
      });
      this.host.emit({
        type: "draft.set_planned.response",
        payload: { requestId: request.requestId, artifact, error: null },
      });
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) {
        this.host.emit({
          type: "draft.set_planned.response",
          payload: { requestId: request.requestId, artifact: null, error: error.message },
        });
        return;
      }
      this.emitRpcError(request, error);
    }
  }

  private async handleSetArchived(
    storage: DraftStorage,
    request: Extract<DraftInbound, { type: "draft.set_archived.request" }>,
  ): Promise<void> {
    try {
      const artifact = await storage.setArchived({
        id: request.artifactId,
        archived: request.archived,
      });
      this.host.emit({
        type: "draft.set_archived.response",
        payload: { requestId: request.requestId, artifact, error: null },
      });
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) {
        this.host.emit({
          type: "draft.set_archived.response",
          payload: { requestId: request.requestId, artifact: null, error: error.message },
        });
        return;
      }
      this.emitRpcError(request, error);
    }
  }

  private async handleGetSnapshot(
    storage: DraftStorage,
    request: Extract<DraftInbound, { type: "draft.get_snapshot.request" }>,
  ): Promise<void> {
    try {
      const detail = await storage.get(request.artifactId);
      const snapshot = detail?.snapshots.find((entry) => entry.rev === request.rev) ?? null;
      this.host.emit({
        type: "draft.get_snapshot.response",
        payload: { requestId: request.requestId, snapshot },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  private emitRpcError(request: DraftInbound, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error({ err: error, requestType: request.type }, "Draft request failed");
    this.host.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: message,
        code: "draft_request_failed",
      },
    });
  }
}

/** The wire record, without the assembled snapshots and dispatches. */
function toRecord(detail: { snapshots: unknown; dispatches: unknown } & ArtifactRecord) {
  const { snapshots: _snapshots, dispatches: _dispatches, ...record } = detail;
  return record;
}
