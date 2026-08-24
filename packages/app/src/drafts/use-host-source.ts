import { useMemo } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostRuntimeClient, getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import { getSharedMockDraftsSource } from "./context";
import { DaemonDraftsSource } from "./daemon-source";
import type { DraftsSource } from "./source";

/**
 * The daemon-backed source when the host has the `draft.*` domain, and the mock
 * when it does not.
 *
 * Gated once on `server_info.features.drafts`, with no fallback path: an older
 * daemon has nowhere to put a draft, so there is nothing to degrade to. The mock
 * is for development, not for talking to a host that cannot store anything.
 */
export function useHostDraftsSource(serverId: string | null): DraftsSource {
  const client = useHostRuntimeClient(serverId ?? "");
  const supportsDrafts = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.drafts === true,
  );
  const workspaces = useSessionStore((state) => state.sessions[serverId ?? ""]?.workspaces);

  return useMemo(() => {
    // Until a host has the domain, the screens keep running on the mock rather
    // than showing nothing — the two surfaces are still worth developing against.
    if (!serverId || !client || !supportsDrafts) return getSharedMockDraftsSource();
    return sourceFor({ serverId, client, workspaces });
  }, [client, serverId, supportsDrafts, workspaces]);
}

/** One host that has drafts, and the source that talks to it. */
export interface DraftHost {
  serverId: string;
  source: DraftsSource;
}

/**
 * Every connected host that has the domain.
 *
 * The Drafts destination spans hosts the way the sidebar and History do: a
 * draft belongs to the daemon that stores it, and a list that quietly showed
 * only one host's would be wrong without ever saying so. D19.
 *
 * Sources cannot come from a hook per host — the host list is dynamic — so they
 * are cached by (serverId, client). The client identity is part of the key
 * because a reconnect hands out a new one, and a source bound to the old client
 * would talk to a socket nobody is listening on.
 */
export function useDraftHosts(): DraftHost[] {
  const sessions = useSessionStore((state) => state.sessions);
  return useMemo(() => {
    const hosts: DraftHost[] = [];
    for (const [serverId, session] of Object.entries(sessions)) {
      if (session.serverInfo?.features?.drafts !== true) continue;
      const client = getHostRuntimeStore().getSnapshot(serverId)?.client;
      if (!client) continue;
      hosts.push({
        serverId,
        source: sourceFor({ serverId, client, workspaces: session.workspaces }),
      });
    }
    return hosts;
  }, [sessions]);
}

interface SourceInput {
  serverId: string;
  client: DaemonClient;
  workspaces: Map<string, WorkspaceDescriptor> | undefined;
}

const sources = new Map<string, { client: DaemonClient; source: DraftsSource }>();

function sourceFor(input: SourceInput): DraftsSource {
  const cached = sources.get(input.serverId);
  if (cached && cached.client === input.client) return cached.source;
  const source = buildDaemonSource(input);
  sources.set(input.serverId, { client: input.client, source });
  return source;
}

function buildDaemonSource(input: SourceInput): DraftsSource {
  const cwdFor = (workspaceId: string): string => {
    // `workspaceDirectory` is the cwd — the composer's own create path resolves
    // it the same way.
    const cwd = input.workspaces?.get(workspaceId)?.workspaceDirectory;
    if (!cwd) throw new Error(`Workspace ${workspaceId} is not available on this host`);
    return cwd;
  };

  return new DaemonDraftsSource({
    client: input.client,
    // The ordinary create path, with the draft's bridge id and labels attached.
    // Nothing about it is drafts-specific except those two fields.
    createAgent: async ({ target, body, clientMessageId, labels }) => {
      const snapshot = await input.client.createAgent({
        config: buildWorkspaceDraftAgentConfig({
          provider: target.provider,
          cwd: cwdFor(target.workspaceId),
          ...(target.model ? { model: target.model } : {}),
        }),
        workspaceId: target.workspaceId,
        initialPrompt: body,
        clientMessageId,
        labels,
      });
      return { agentId: snapshot.id };
    },
    sendToAgent: ({ agentId, body, clientMessageId }) =>
      input.client.sendMessage(agentId, body, { messageId: clientMessageId }),
  });
}
