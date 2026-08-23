import { memo, useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useSessionStore } from "@/stores/session-store";
import type { PlannedTarget } from "./model";

/**
 * Picks a place to plan a draft for. Both grains are offered because the case a
 * plan exists for is often a workspace that does not exist yet — the draft is
 * for this project, and the worktree gets cut when the work starts.
 */

interface PlanOption {
  key: string;
  target: PlannedTarget;
  title: string;
  subtitle: string;
}

function optionStyle({ pressed }: PressableStateCallbackType) {
  return [styles.option, pressed && styles.pressed];
}

const PlanRow = memo(function PlanRow({
  option,
  onSelect,
}: {
  option: PlanOption;
  onSelect: (target: PlannedTarget) => void;
}) {
  const onPress = useCallback(() => onSelect(option.target), [onSelect, option.target]);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={optionStyle}>
      <Text style={styles.optionTitle}>{option.title}</Text>
      <Text style={styles.optionSubtitle}>{option.subtitle}</Text>
    </Pressable>
  );
});

export function PlanSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (target: PlannedTarget) => void;
}) {
  const { t } = useTranslation();
  const sessions = useSessionStore((state) => state.sessions);

  const options = useMemo<PlanOption[]>(() => {
    const rows: PlanOption[] = [];
    const seenProjects = new Set<string>();
    for (const session of Object.values(sessions)) {
      for (const workspace of Object.values(session.workspaces ?? {})) {
        if (!seenProjects.has(workspace.projectId)) {
          seenProjects.add(workspace.projectId);
          rows.push({
            key: `project:${workspace.projectId}`,
            target: { kind: "project", projectId: workspace.projectId },
            title: `◆ ${workspace.projectDisplayName}`,
            subtitle: t("drafts.plan.projectSubtitle"),
          });
        }
        rows.push({
          key: `workspace:${workspace.id}`,
          target: { kind: "workspace", workspaceId: workspace.id },
          title: `▣ ${workspace.projectDisplayName} · ${workspace.name}`,
          subtitle: workspace.workspaceDirectory,
        });
      }
    }
    return rows;
  }, [sessions, t]);

  const header = useMemo(
    () => ({ title: t("drafts.plan.title"), subtitle: t("drafts.plan.subtitle") }),
    [t],
  );

  return (
    <AdaptiveModalSheet header={header} visible={visible} onClose={onClose} scrollable>
      {options.length === 0 ? (
        <View style={styles.option}>
          <Text style={styles.optionSubtitle}>{t("drafts.plan.noTargets")}</Text>
        </View>
      ) : (
        options.map((option) => <PlanRow key={option.key} option={option} onSelect={onSelect} />)
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
  optionTitle: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
  optionSubtitle: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
