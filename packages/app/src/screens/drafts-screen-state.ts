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

/** Where a query matched a draft, and the text around the match if it is not current. */
export interface DraftSearchMatch {
  /** The revision the words were found in, or null when the current text has them. */
  rev: number | null;
  /** Only meaningful with a `rev`: the client holds no copy of that revision. */
  excerpt?: string;
}

/**
 * Which hit a row should explain itself with.
 *
 * A current-text hit outranks an old-revision one — the words are still there,
 * and the row's own preview shows them. Among revisions the earliest wins, so
 * the row names where the phrase entered the draft rather than the last place
 * it survived.
 */
export function pickSearchMatch(
  hits: readonly { rev: number | null; excerpt?: string }[],
): DraftSearchMatch | null {
  let best: DraftSearchMatch | null = null;
  for (const hit of hits) {
    if (hit.rev === null) return { rev: null };
    if (best === null || (best.rev !== null && hit.rev < best.rev)) {
      best = { rev: hit.rev, excerpt: hit.excerpt };
    }
  }
  return best;
}
