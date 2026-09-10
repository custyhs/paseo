/**
 * What the Drafts list says when it has nothing to show.
 *
 * "No drafts yet" and "this host cannot store drafts" look identical on screen
 * and mean opposite things: one invites you to write, the other says nothing
 * you write here can be kept. `docs/protocol-compatibility.md` asks a feature
 * to gate on the capability and then say the host needs updating, and the
 * Scratchpad panel already does; the list has to agree with it.
 */
export type DraftsListEmptyState = "unsupported" | "no-host" | "no-matches" | "empty" | null;

export function resolveDraftsListEmptyState(input: {
  /** Hosts advertising `features.drafts`. */
  capableHostCount: number;
  /**
   * Hosts that finished a handshake, capable or not. A configured host whose
   * daemon is down is not one of these: it has not said what it supports, so
   * telling the user to upgrade it would be a guess.
   */
  connectedHostCount: number;
  hasSearch: boolean;
  visibleDraftCount: number;
}): DraftsListEmptyState {
  if (input.visibleDraftCount > 0) return null;
  if (input.connectedHostCount === 0) return "no-host";
  if (input.capableHostCount === 0) return "unsupported";
  return input.hasSearch ? "no-matches" : "empty";
}
