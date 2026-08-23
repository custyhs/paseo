import type { DraftCheckpointStore } from "./checkpoint";
import type { ArtifactDetail } from "./model";
import { DraftVersionConflictError, type DraftsSource } from "./source";

/**
 * The editor's save loop, as a plain object so it can be tested without a
 * renderer — and so the tests guard the code that actually ships rather than a
 * transcription of it.
 *
 * Two properties are the whole point (ADR-0004):
 *
 * - Text leaves the queue only once the daemon has accepted it. Clearing it
 *   before the write resolves means a failed write has nothing left to retry.
 * - A failed write is a visible state. `saved` must never be shown for text
 *   that only exists on this machine.
 */

/** A pause, not a keystroke, earns a write. Matches the composer's cadence. */
export const DRAFT_WRITE_DEBOUNCE_MS = 200;

export type DraftSaveState =
  | { status: "saved" }
  | { status: "saving" }
  /** The text is checkpointed locally; the daemon does not have it. */
  | { status: "unsaved" }
  /** Someone else changed the draft. `remote` is the record as it now stands. */
  | { status: "conflict"; remote: ArtifactDetail };

export interface DraftSaveLoop {
  onChangeText: (next: string) => void;
  /** Writes anything outstanding now, without waiting for the debounce. */
  flush: () => Promise<void>;
  hasPendingText: () => boolean;
  /** Adopts a version this client advanced by other means, such as sending. */
  noteVersion: (version: number) => void;
  /** Conflict: keep what the other client wrote, drop ours. */
  reload: (remote: ArtifactDetail) => Promise<void>;
  /** Conflict: put ours on top, by retrying against the version we were shown. */
  overwrite: (remote: ArtifactDetail) => Promise<void>;
  dispose: () => void;
}

export function createDraftSaveLoop(input: {
  source: DraftsSource;
  checkpoints: DraftCheckpointStore;
  serverId: string;
  artifactId: string;
  version: number;
  onState: (state: DraftSaveState) => void;
  onSaved?: (artifact: ArtifactDetail) => void;
  now?: () => number;
  debounceMs?: number;
}): DraftSaveLoop {
  const { source, checkpoints, serverId, artifactId, onState, onSaved } = input;
  const now = input.now ?? Date.now;
  const debounceMs = input.debounceMs ?? DRAFT_WRITE_DEBOUNCE_MS;

  let version = input.version;
  let pending: string | null = null;
  let inFlight = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    onState({ status: "saving" });
    try {
      while (pending !== null) {
        const body = pending;
        let saved: ArtifactDetail;
        try {
          saved = await source.update({ artifactId, baseVersion: version, body });
        } catch (error) {
          // The text stays queued and stays checkpointed. Retrying is the next
          // keystroke, the next flush, or reconnecting — never a lost paragraph.
          if (error instanceof DraftVersionConflictError) {
            const remote = await source.get(artifactId).catch(() => null);
            onState(remote ? { status: "conflict", remote } : { status: "unsaved" });
          } else {
            onState({ status: "unsaved" });
          }
          return;
        }
        version = saved.version;
        onSaved?.(saved);
        // Newer keystrokes may have landed during the await; those are still
        // owed to the daemon, so only retire the text we actually sent.
        if (pending === body) pending = null;
      }
      await checkpoints.clear(serverId, artifactId);
      onState({ status: "saved" });
    } finally {
      inFlight = false;
    }
  };

  return {
    onChangeText(next: string) {
      if (disposed) return;
      pending = next;
      // The checkpoint is not debounced. It exists precisely to cover the
      // window before the daemon hears about this, so it has to be written
      // inside that window.
      void checkpoints.put({
        serverId,
        artifactId,
        body: next,
        baseVersion: version,
        updatedAt: now(),
      });
      onState({ status: "unsaved" });
      cancelTimer();
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, debounceMs);
    },

    flush,

    hasPendingText: () => pending !== null,

    noteVersion(next: number) {
      version = next;
    },

    async reload(remote: ArtifactDetail) {
      pending = null;
      version = remote.version;
      await checkpoints.clear(serverId, artifactId);
      onState({ status: "saved" });
    },

    async overwrite(remote: ArtifactDetail) {
      // Not a new RPC and not a force flag — just a retry against the version
      // we have now been shown (ADR-0002 decision 4).
      version = remote.version;
      await flush();
    },

    // Cancels the debounce and stops accepting keystrokes. An in-flight or
    // explicitly requested flush still runs to completion — unmounting is the
    // moment the outstanding text most needs to be written.
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}
