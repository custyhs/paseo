import { useMemo } from "react";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import type { WorkspaceProjectLookup } from "./model";

/**
 * Reads workspaces and agents out of the session store.
 *
 * The store keeps `sessions` as a plain record but everything inside a session —
 * `workspaces`, `agents` — as a `Map`. `Object.values()` on a Map returns an
 * empty array and type-checks anyway, because its `(o: {}) => any[]` overload
 * accepts anything. Every drafts surface reads these lists, so they read them
 * through here rather than each rediscovering that.
 */

export function useServerWorkspaces(serverId: string | null): WorkspaceDescriptor[] {
  const workspaces = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.workspaces : undefined,
  );
  return useMemo(() => (workspaces ? [...workspaces.values()] : []), [workspaces]);
}

/** Every workspace on every connected host, for surfaces that are not host-scoped. */
export function useAllWorkspaces(): WorkspaceDescriptor[] {
  const sessions = useSessionStore((state) => state.sessions);
  return useMemo(() => {
    const all: WorkspaceDescriptor[] = [];
    for (const session of Object.values(sessions)) {
      for (const workspace of session.workspaces.values()) all.push(workspace);
    }
    return all;
  }, [sessions]);
}

export interface DraftAgentOption {
  id: string;
  title: string | null;
  provider: string;
  workspaceId: string | null;
}

export function useServerAgents(serverId: string | null): DraftAgentOption[] {
  const agents = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.agents : undefined,
  );
  return useMemo(() => {
    if (!agents) return [];
    return [...agents.values()].map((agent) => ({
      id: agent.id,
      title: agent.title ?? null,
      provider: agent.provider,
      workspaceId: agent.workspaceId ?? null,
    }));
  }, [agents]);
}

/**
 * Resolves a workspace to its project so a project-level plan can surface in
 * every workspace of that project — the case such a plan exists for, since the
 * worktree it is meant for often does not exist when the draft is written.
 */
export function useWorkspaceProjectLookup(): WorkspaceProjectLookup {
  const workspaces = useAllWorkspaces();
  return useMemo(() => {
    const byId = new Map<string, string>();
    for (const workspace of workspaces) byId.set(workspace.id, workspace.projectId);
    return { projectIdForWorkspace: (workspaceId: string) => byId.get(workspaceId) ?? null };
  }, [workspaces]);
}

export function describeWorkspace(workspace: WorkspaceDescriptor): string {
  return `${workspace.projectDisplayName} · ${workspace.name}`;
}
