import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MockDraftsSource } from "./mock-source";
import type { ArtifactDetail } from "./model";
import type { DraftsSource } from "./source";

/**
 * Supplies the drafts UI with its data source. The provider exists so the
 * screens never reach for a singleton: swapping the in-memory implementation for
 * the daemon-backed one is a change here and nowhere else.
 *
 * Until the `draft.*` RPCs land, the default is a mock seeded with enough
 * material to exercise every state the panel can show — including the one that
 * matters most, a draft that ran here and has since been edited.
 */

const DraftsSourceContext = createContext<DraftsSource | null>(null);

function seedArtifacts(): ArtifactDetail[] {
  const day = (value: string) => `2026-08-${value}T12:00:00.000Z`;
  return [
    {
      id: "drf_seed_parser",
      title: "Parser incremental update",
      body: [
        "Next stage: make the parser incremental instead of re-parsing the whole buffer.",
        "",
        "- Do not change the public AST node shape; downstream consumers depend on it.",
        "- Reuse the existing dirty-range tracker rather than inventing a new one.",
        "- Keep the cold-parse path as a fallback. Incremental is an optimization.",
      ].join("\n"),
      version: 23,
      planned: [{ kind: "workspace", workspaceId: "__current__" }],
      createdAt: day("17"),
      updatedAt: day("23"),
      archivedAt: null,
      snapshots: [
        {
          rev: 17,
          createdAt: day("17"),
          body: "First cut: make the parser incremental. Reuse the dirty-range tracker.",
        },
      ],
      dispatches: [
        {
          id: "dsp_seed_1",
          rev: 17,
          clientMessageId: "cmid_9f21",
          agentId: null,
          workspaceId: "__current__",
          createdAt: day("17"),
          status: "sent",
          error: null,
        },
      ],
    },
    {
      id: "drf_seed_cold",
      title: "Cold parse fallback",
      body: "Get the cold parse path green before touching anything incremental.",
      version: 8,
      planned: [{ kind: "workspace", workspaceId: "__current__" }],
      createdAt: day("16"),
      updatedAt: day("17"),
      archivedAt: null,
      snapshots: [{ rev: 8, createdAt: day("17"), body: "Get the cold parse path green." }],
      dispatches: [
        {
          id: "dsp_seed_2",
          rev: 8,
          clientMessageId: "cmid_44a2",
          agentId: null,
          workspaceId: "__current__",
          createdAt: day("17"),
          status: "sent",
          error: null,
        },
      ],
    },
  ];
}

/** Seeds bind to whichever workspace the panel first renders in. */
function bindSeedsToWorkspace(workspaceId: string): ArtifactDetail[] {
  const bound = seedArtifacts();
  for (const artifact of bound) {
    for (const [index, target] of artifact.planned.entries()) {
      if (target.kind === "workspace" && target.workspaceId === "__current__") {
        artifact.planned[index] = { kind: "workspace", workspaceId };
      }
    }
    for (const dispatch of artifact.dispatches) {
      if (dispatch.workspaceId === "__current__") dispatch.workspaceId = workspaceId;
    }
  }
  return bound;
}

let sharedMock: MockDraftsSource | null = null;

/**
 * One mock per app run, so the two surfaces genuinely share a store — a draft
 * created in the scratchpad has to show up in the Drafts destination, which is
 * the whole claim of "two views, one store".
 */
export function getSharedMockDraftsSource(workspaceId?: string): DraftsSource {
  // Seeds only bind when a workspace asks first. Reaching the mock from the
  // global destination has no workspace to bind to, and inventing one would put
  // drafts in a scratchpad the user never opened.
  sharedMock ??= new MockDraftsSource({
    seed: workspaceId === undefined ? [] : bindSeedsToWorkspace(workspaceId),
  });
  return sharedMock;
}

export function DraftsSourceProvider({
  children,
  source,
}: {
  children: ReactNode;
  source: DraftsSource;
}) {
  return <DraftsSourceContext.Provider value={source}>{children}</DraftsSourceContext.Provider>;
}

/**
 * `seedWorkspaceId` only matters for the mock: it decides which workspace the
 * demo drafts are planned for. Surfaces that are not standing in a workspace
 * omit it.
 */
export function useDraftsSource(seedWorkspaceId?: string): DraftsSource {
  const injected = useContext(DraftsSourceContext);
  return useMemo(
    () => injected ?? getSharedMockDraftsSource(seedWorkspaceId),
    [injected, seedWorkspaceId],
  );
}

export interface DraftsQueryState {
  artifacts: ArtifactDetail[];
  isLoading: boolean;
}

/**
 * Reads every draft and re-reads on any mutation. Fine at this corpus size and
 * deliberately dumb: pagination and incremental updates are the daemon-backed
 * implementation's problem, not a shape the UI should be built around.
 */
export function useAllDrafts(source: DraftsSource): DraftsQueryState {
  const [state, setState] = useState<DraftsQueryState>({ artifacts: [], isLoading: true });

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const summaries = await source.list();
      const details = await Promise.all(summaries.map((entry) => source.get(entry.id)));
      if (cancelled) return;
      setState({
        artifacts: details.filter((entry): entry is ArtifactDetail => entry !== null),
        isLoading: false,
      });
    };
    void read();
    const unsubscribe = source.subscribe(() => {
      void read();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [source]);

  return state;
}
