import { describe, expect, test } from "vitest";
import { pickSearchMatch, resolveDraftsListEmptyState } from "./drafts-screen-state";

describe("what the Drafts list says when it is empty", () => {
  const base = {
    capableHostCount: 1,
    connectedHostCount: 1,
    hasSearch: false,
    visibleDraftCount: 0,
  };

  test("a connected host that cannot store drafts says so", () => {
    expect(resolveDraftsListEmptyState({ ...base, capableHostCount: 0 })).toBe("unsupported");
  });

  test("a capable host with no drafts invites writing one", () => {
    expect(resolveDraftsListEmptyState(base)).toBe("empty");
  });

  test("a search that matched nothing says that, not that there are no drafts", () => {
    expect(resolveDraftsListEmptyState({ ...base, hasSearch: true })).toBe("no-matches");
  });

  test("no host at all is neither of those", () => {
    expect(
      resolveDraftsListEmptyState({ ...base, capableHostCount: 0, connectedHostCount: 0 }),
    ).toBe("no-host");
  });

  test("a search with hits is not an empty state", () => {
    expect(
      resolveDraftsListEmptyState({ ...base, hasSearch: true, visibleDraftCount: 2 }),
    ).toBeNull();
  });

  test("an incapable host outranks a search that found nothing", () => {
    // The search could not have reached that host, so blaming the query lies.
    expect(resolveDraftsListEmptyState({ ...base, capableHostCount: 0, hasSearch: true })).toBe(
      "unsupported",
    );
  });
});

describe("a host that is merely offline", () => {
  test("is not reported as a host that cannot store drafts", () => {
    // The daemon being down says nothing about its version. Sending the user
    // to upgrade it would be a guess, and the wrong one.
    expect(
      resolveDraftsListEmptyState({
        capableHostCount: 0,
        connectedHostCount: 0,
        hasSearch: false,
        visibleDraftCount: 0,
      }),
    ).not.toBe("unsupported");
  });
});

describe("which hit a row explains itself with", () => {
  test("current text outranks an old revision", () => {
    expect(pickSearchMatch([{ rev: 7, excerpt: "…in revision seven…" }, { rev: null }])).toEqual({
      rev: null,
    });
  });

  test("the earliest revision wins, with its own excerpt", () => {
    expect(
      pickSearchMatch([
        { rev: 7, excerpt: "…seven…" },
        { rev: 2, excerpt: "…two…" },
      ]),
    ).toEqual({ rev: 2, excerpt: "…two…" });
  });

  test("no hits is no match", () => {
    expect(pickSearchMatch([])).toBeNull();
  });

  test("a revision hit without an excerpt still identifies the revision", () => {
    expect(pickSearchMatch([{ rev: 4 }])).toEqual({ rev: 4, excerpt: undefined });
  });
});
