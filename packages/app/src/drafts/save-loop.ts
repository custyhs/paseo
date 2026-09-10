import type { DraftCheckpoint, DraftCheckpointStore } from "./checkpoint";
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

/**
 * One edit still owed to the daemon. Title and body share a queue because they
 * share a `version`: two independent writers would each send their own
 * `baseVersion` and collide with each other on every other keystroke.
 */
interface PendingEdit {
  title?: string | null;
  body?: string;
}

export interface DraftSaveLoop {
  onChangeText: (next: string) => void;
  onChangeTitle: (next: string) => void;
  /**
   * Writes anything outstanding now, without waiting for the debounce, and
   * resolves with the state it settled on. A caller that needs the daemon to
   * hold the text — sending does — has to read that state rather than assume
   * the write landed.
   */
  flush: () => Promise<DraftSaveState>;
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
  /**
   * Text this client owed the daemon when it last went away. Adopting it is
   * what makes a checkpoint a safety net rather than a write-only log: the
   * editor seeds its fields from the same record, and the write retries from
   * here.
   */
  recover?: DraftCheckpoint;
}): DraftSaveLoop {
  const { source, checkpoints, serverId, artifactId, onState, onSaved } = input;
  const now = input.now ?? Date.now;
  const debounceMs = input.debounceMs ?? DRAFT_WRITE_DEBOUNCE_MS;

  let version = input.version;
  let pending: PendingEdit | null = null;
  /** The write on the wire, so a second caller can await it instead of racing it. */
  let inFlight: Promise<void> | null = null;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let state: DraftSaveState = { status: "saved" };

  const setState = (next: DraftSaveState) => {
    state = next;
    onState(next);
  };

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const drain = async (): Promise<void> => {
    setState({ status: "saving" });
    while (pending !== null) {
      const sent = pending;
      let saved: ArtifactDetail;
      try {
        saved = await source.update({ artifactId, baseVersion: version, ...sent });
      } catch (error) {
        // The text stays queued and stays checkpointed. Retrying is the next
        // keystroke, the next flush, or reconnecting — never a lost paragraph.
        if (error instanceof DraftVersionConflictError) {
          const remote = await source.get(artifactId).catch(() => null);
          setState(remote ? { status: "conflict", remote } : { status: "unsaved" });
        } else {
          setState({ status: "unsaved" });
        }
        return;
      }
      version = saved.version;
      onSaved?.(saved);
      // Newer keystrokes may have landed during the await; those are still
      // owed to the daemon, so only retire the edit we actually sent. Every
      // keystroke replaces the object, so identity is the whole comparison.
      if (pending === sent) pending = null;
    }
    await checkpoints.clear(serverId, artifactId);
    setState({ status: "saved" });
  };

  /**
   * Awaiting the write already on the wire rather than returning early is what
   * makes this usable as a barrier. Returning early would tell a send the queue
   * was empty while the daemon was still being told about the last keystroke,
   * and the snapshot would freeze the older body.
   */
  const flush = async (): Promise<DraftSaveState> => {
    // Awaiting the write is what retires it, so this settles rather than spins.
    for (let writing = inFlight; writing !== null; writing = inFlight) {
      await writing;
    }
    if (pending === null) return state;
    inFlight = drain();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    return state;
  };

  /**
   * The checkpoint is not debounced. It exists precisely to cover the window
   * before the daemon hears about this, so it has to be written inside that
   * window. Only the daemon hop is debounced.
   */
  const queue = (edit: PendingEdit) => {
    if (disposed) return;
    pending = { ...pending, ...edit };
    const carried = pending;
    void checkpoints.put({
      serverId,
      artifactId,
      ...(carried.body !== undefined ? { body: carried.body } : {}),
      ...(carried.title !== undefined ? { title: carried.title } : {}),
      baseVersion: version,
      updatedAt: now(),
    });
    setState({ status: "unsaved" });
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounceMs);
  };

  if (input.recover) {
    // The version the text was typed against, not the one the editor was
    // handed. Writing it under a newer version would overwrite whoever moved
    // the draft on in the meantime; under this one the daemon says so, and the
    // conflict bar gets its turn.
    version = input.recover.baseVersion;
    queue({
      ...(input.recover.body !== undefined ? { body: input.recover.body } : {}),
      ...("title" in input.recover ? { title: input.recover.title ?? null } : {}),
    });
  }

  return {
    onChangeText(next: string) {
      queue({ body: next });
    },

    onChangeTitle(next: string) {
      // Empty means "no title of its own", which is what the list falls back
      // from — not an empty heading.
      queue({ title: next.trim() === "" ? null : next });
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
      setState({ status: "saved" });
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
