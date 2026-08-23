import { memo, useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import type { ArtifactDetail } from "./model";
import { describeWorkspace, useServerAgents, useServerWorkspaces } from "./workspaces";
import type { SendTarget } from "./source";

/**
 * Picks where a revision goes. Planned targets come first and are marked, which
 * is the payoff that makes planning worth maintaining: the target you already
 * declared is the one already selected.
 */

interface TargetOption {
  key: string;
  target: SendTarget;
  title: string;
  subtitle: string;
  isPlanned: boolean;
}

function optionStyle({ pressed }: PressableStateCallbackType) {
  return [styles.option, pressed && styles.pressed];
}

const TargetRow = memo(function TargetRow({
  option,
  onSelect,
}: {
  option: TargetOption;
  onSelect: (target: SendTarget) => void;
}) {
  const { t } = useTranslation();
  const onPress = useCallback(() => onSelect(option.target), [onSelect, option.target]);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={optionStyle}>
      <View style={styles.optionHead}>
        <Text style={styles.optionTitle}>{option.title}</Text>
        {option.isPlanned ? (
          <Text style={styles.plannedTag}>{t("drafts.send.plannedTag")}</Text>
        ) : null}
      </View>
      <Text style={styles.optionSubtitle}>{option.subtitle}</Text>
    </Pressable>
  );
});

export function SendSheet({
  artifact,
  serverId,
  visible,
  onClose,
  onSend,
}: {
  artifact: ArtifactDetail;
  serverId: string;
  visible: boolean;
  onClose: () => void;
  onSend: (target: SendTarget) => void;
}) {
  const { t } = useTranslation();
  const workspaces = useServerWorkspaces(serverId);
  const agents = useServerAgents(serverId);

  const options = useMemo<TargetOption[]>(() => {
    const plannedWorkspaceIds = new Set(
      artifact.planned
        .filter((target) => target.kind === "workspace")
        .map((target) => target.workspaceId),
    );
    const plannedProjectIds = new Set(
      artifact.planned
        .filter((target) => target.kind === "project")
        .map((target) => target.projectId),
    );

    const rank = (workspaceId: string, projectId: string) => {
      if (plannedWorkspaceIds.has(workspaceId)) return 0;
      if (plannedProjectIds.has(projectId)) return 1;
      return 2;
    };

    const rows: Array<TargetOption & { rank: number }> = [];
    for (const workspace of workspaces) {
      const workspaceRank = rank(workspace.id, workspace.projectId);
      const where = describeWorkspace(workspace);
      rows.push({
        rank: workspaceRank,
        key: `new:${workspace.id}`,
        target: { kind: "new_agent", workspaceId: workspace.id },
        title: t("drafts.send.newAgentIn", { where }),
        subtitle: t("drafts.send.newAgentSubtitle"),
        isPlanned: workspaceRank < 2,
      });
      for (const agent of agents) {
        if (agent.workspaceId !== workspace.id) continue;
        rows.push({
          rank: workspaceRank,
          key: `agent:${agent.id}`,
          target: { kind: "existing_agent", agentId: agent.id, workspaceId: workspace.id },
          title: t("drafts.send.existingAgent", {
            title: agent.title ?? agent.provider,
          }),
          subtitle: where,
          isPlanned: workspaceRank < 2,
        });
      }
    }
    rows.sort((left, right) => left.rank - right.rank);
    return rows.map(({ rank: _rank, ...option }) => option);
  }, [workspaces, agents, artifact.planned, t]);

  const header = useMemo(
    () => ({ title: t("drafts.send.title"), subtitle: t("drafts.send.subtitle") }),
    [t],
  );

  return (
    <AdaptiveModalSheet header={header} visible={visible} onClose={onClose} scrollable>
      {options.length === 0 ? (
        <Text style={styles.optionSubtitle}>{t("drafts.send.noTargets")}</Text>
      ) : (
        options.map((option) => <TargetRow key={option.key} option={option} onSelect={onSend} />)
      )}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  option: {
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing[0.5],
  },
  pressed: { opacity: 0.7 },
  optionHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  optionTitle: { flex: 1, fontSize: theme.fontSize.base, color: theme.colors.foreground },
  optionSubtitle: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  plannedTag: { fontSize: theme.fontSize.sm, color: theme.colors.accentBright },
}));
