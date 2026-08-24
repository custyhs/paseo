import { randomUUID } from "node:crypto";
import type pino from "pino";
import {
  compareMatchScores,
  scoreTextFields,
  tokenizeQuery,
  type MatchScore,
} from "@getpaseo/protocol/search/text-match";
import type { DraftSearchHit } from "@getpaseo/protocol/draft/rpc-schemas";
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
      case "draft.capture_revision.request":
        return this.handleCaptureRevision(storage, request);
      case "draft.settle_dispatch.request":
        return this.handleSettleDispatch(storage, request);
      case "draft.search.request":
        return this.handleSearch(storage, request);
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

  /**
   * Freezes the current body and records the intent to send it. The client then
   * calls `createAgent` or `sendMessage` itself, carrying the `clientMessageId`
   * this returns, and settles afterwards — see ADR-0003 for why the middle step
   * is not ours.
   */
  private async handleCaptureRevision(
    storage: DraftStorage,
    request: Extract<DraftInbound, { type: "draft.capture_revision.request" }>,
  ): Promise<void> {
    try {
      const snapshot = await storage.captureSnapshot({ artifactId: request.artifactId });
      const dispatch = await storage.recordDispatch({
        artifactId: request.artifactId,
        rev: snapshot.rev,
        clientMessageId: randomUUID(),
        workspaceId: request.target.workspaceId,
        agentId: request.target.kind === "existing_agent" ? request.target.agentId : null,
        status: "pending",
      });
      const detail = await storage.get(request.artifactId);
      this.host.emit({
        type: "draft.capture_revision.response",
        payload: {
          requestId: request.requestId,
          artifact: detail ? toRecord(detail) : null,
          snapshot,
          dispatch,
          error: null,
        },
      });
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) {
        this.host.emit({
          type: "draft.capture_revision.response",
          payload: {
            requestId: request.requestId,
            artifact: null,
            snapshot: null,
            dispatch: null,
            error: error.message,
          },
        });
        return;
      }
      this.emitRpcError(request, error);
    }
  }

  /**
   * What became of the send. Appended, never rewritten — a failed send keeps its
   * snapshot and gains a `failed` dispatch, because the snapshot is what the
   * user meant to send and that is worth more, not less, when it did not arrive.
   */
  private async handleSettleDispatch(
    storage: DraftStorage,
    request: Extract<DraftInbound, { type: "draft.settle_dispatch.request" }>,
  ): Promise<void> {
    try {
      const dispatch = await storage.settleDispatch({
        artifactId: request.artifactId,
        dispatchId: request.dispatchId,
        status: request.status,
        ...(request.agentId !== undefined ? { agentId: request.agentId } : {}),
        ...(request.error !== undefined ? { error: request.error } : {}),
      });
      this.host.emit({
        type: "draft.settle_dispatch.response",
        payload: { requestId: request.requestId, dispatch, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "draft.settle_dispatch.response",
        payload: {
          requestId: request.requestId,
          dispatch: null,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Searches current bodies and every captured revision. Running here rather
   * than on the client is the whole point: snapshots are not replicated, so a
   * paragraph you sent and later edited away is findable only where the files
   * are (ADR-0005).
   *
   * No index. Hundreds of drafts of a few KB each scan in milliseconds, and an
   * index would owe answers about invalidation and rebuild-after-crash that cost
   * more than they save at this size.
   */
  private async handleSearch(
    storage: DraftStorage,
    request: Extract<DraftInbound, { type: "draft.search.request" }>,
  ): Promise<void> {
    try {
      const hits: DraftSearchHit[] = [];
      const scored: { hit: DraftSearchHit; score: MatchScore }[] = [];
      for (const record of await storage.list({ includeArchived: true })) {
        const detail = await storage.get(record.id);
        if (!detail) continue;
        const archived = detail.archivedAt !== null;

        const current = scoreTextFields(request.query, [detail.title ?? "", detail.body]);
        if (current) {
          scored.push({
            hit: { artifactId: detail.id, where: { kind: "artifact" }, archived },
            score: current,
          });
        }

        for (const snapshot of detail.snapshots) {
          // Skip a revision whose text the current body already matched; the
          // draft would otherwise appear twice for words it never lost.
          if (current && snapshot.body === detail.body) continue;
          const score = scoreTextFields(request.query, [snapshot.body]);
          if (!score) continue;
          scored.push({
            hit: {
              artifactId: detail.id,
              where: { kind: "snapshot", rev: snapshot.rev },
              excerpt: excerptAround(request.query, snapshot.body),
              archived,
            },
            score,
          });
        }
      }

      scored.sort((left, right) => compareMatchScores(left.score, right.score));
      const limit = request.limit ?? DEFAULT_SEARCH_LIMIT;
      for (const entry of scored.slice(0, limit)) hits.push(entry.hit);

      this.host.emit({
        type: "draft.search.response",
        payload: { requestId: request.requestId, query: request.query, hits },
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

const DEFAULT_SEARCH_LIMIT = 50;
const EXCERPT_RADIUS = 90;

/**
 * A window of the snapshot around the first token that matched. The client has
 * no copy of this text, so without it a snapshot hit could only say "somewhere
 * in revision 7".
 */
function excerptAround(query: string, body: string): string {
  const tokens = tokenizeQuery(query);
  const haystack = body.toLowerCase();
  let at = -1;
  for (const token of tokens) {
    const found = haystack.indexOf(token.toLowerCase());
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) return body.slice(0, EXCERPT_RADIUS * 2);
  const start = Math.max(0, at - EXCERPT_RADIUS);
  const end = Math.min(body.length, at + EXCERPT_RADIUS);
  return `${start > 0 ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}`;
}

/** The wire record, without the assembled snapshots and dispatches. */
function toRecord(detail: { snapshots: unknown; dispatches: unknown } & ArtifactRecord) {
  const { snapshots: _snapshots, dispatches: _dispatches, ...record } = detail;
  return record;
}
