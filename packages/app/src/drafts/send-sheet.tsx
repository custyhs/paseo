import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import type { ArtifactDetail } from "./model";
import { describeWorkspace, useServerAgents, useServerWorkspaces } from "./workspaces";
import type { SendTarget } from "./source";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";

/**
 * Picks where a revision goes. Planned targets come first and are marked, which
 * is the payoff that makes planning worth maintaining: the target you already
 * declared is the one already selected.
 *
 * A new agent also has to run something, and the daemon does not decide that for
 * us (ADR-0003). One selector at the top rather than a row per workspace times
 * provider, which on a host with several of each would be a wall of rows; it
 * only applies to the "new agent" rows, since an existing agent already has a
 * provider.
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

const ProviderChip = memo(function ProviderChip({
  id,
  label,
  isSelected,
  onSelect,
}: {
  id: string;
  label: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const onPress = useCallback(() => onSelect(id), [id, onSelect]);
  const selectedState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selectedState}
      testID={`draft-send-provider-${id}`}
      onPress={onPress}
      style={isSelected ? selectedChipStyle : chipStyle}
    >
      <Text style={isSelected ? styles.chipLabelSelected : styles.chipLabel}>{label}</Text>
    </Pressable>
  );
});

function chipStyle({ pressed }: PressableStateCallbackType) {
  return [styles.chip, pressed && styles.pressed];
}

function selectedChipStyle({ pressed }: PressableStateCallbackType) {
  return [styles.chip, styles.chipSelected, pressed && styles.pressed];
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
  const { entries } = useProvidersSnapshot(serverId, { enabled: visible });
  const providers = useMemo(() => buildSelectableProviderSelectorProviders(entries), [entries]);
  const [chosenProvider, setChosenProvider] = useState<string | null>(null);
  // Falls back to the first available rather than refusing to send: picking is
  // worth offering, not worth blocking on.
  const provider = chosenProvider ?? providers[0]?.id ?? null;

  const onSelect = useCallback(
    (target: SendTarget) => {
      if (target.kind !== "new_agent") {
        onSend(target);
        return;
      }
      if (!provider) return;
      onSend({ ...target, provider });
    },
    [onSend, provider],
  );

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
        // The provider is filled in on the way out, from the selector above.
        target: { kind: "new_agent", workspaceId: workspace.id, provider: "" },
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
      {providers.length > 1 ? (
        <View style={styles.providerRow}>
          <Text style={styles.providerLabel}>{t("drafts.send.withProvider")}</Text>
          {providers.map((entry) => (
            <ProviderChip
              key={entry.id}
              id={entry.id}
              label={entry.label}
              isSelected={entry.id === provider}
              onSelect={setChosenProvider}
            />
          ))}
        </View>
      ) : null}
      {options.length === 0 ? (
        <Text style={styles.optionSubtitle}>{t("drafts.send.noTargets")}</Text>
      ) : (
        options.map((option) => <TargetRow key={option.key} option={option} onSelect={onSelect} />)
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
  providerRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  providerLabel: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  chip: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0.5],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipSelected: { borderColor: theme.colors.accentBright },
  chipLabel: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  chipLabelSelected: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
}));
