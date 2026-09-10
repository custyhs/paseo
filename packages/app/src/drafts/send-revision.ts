import type { DraftSaveLoop } from "./save-loop";
import type { DraftsSource, SendResult, SendTarget } from "./source";

/**
 * A send that the daemon does not yet hold the text for.
 *
 * Sending is the one irreversible thing a draft does: the daemon freezes the
 * body it holds into an immutable snapshot, and no later edit can correct it.
 * So a send writes first and refuses second — capturing a revision the user
 * never saw would put words in the agent's input that nobody typed.
 */
export class DraftSendBlockedError extends Error {
  readonly reason: "unsaved" | "conflict";

  constructor(reason: "unsaved" | "conflict") {
    super(
      reason === "conflict"
        ? "This draft changed elsewhere; resolve that before sending"
        : "The host has not accepted this text yet",
    );
    this.name = "DraftSendBlockedError";
    this.reason = reason;
  }
}

/**
 * Writes anything outstanding, then sends. The version the daemon settled on is
 * handed back to the loop so the next keystroke carries the right `baseVersion`
 * instead of colliding with the send's own write.
 */
export async function sendRevision(input: {
  loop: Pick<DraftSaveLoop, "flush" | "noteVersion">;
  source: Pick<DraftsSource, "send">;
  artifactId: string;
  target: SendTarget;
}): Promise<SendResult> {
  const { loop, source, artifactId, target } = input;
  const state = await loop.flush();
  if (state.status === "conflict") throw new DraftSendBlockedError("conflict");
  if (state.status !== "saved") throw new DraftSendBlockedError("unsaved");

  const result = await source.send({ artifactId, target });
  loop.noteVersion(result.artifact.version);
  return result;
}
