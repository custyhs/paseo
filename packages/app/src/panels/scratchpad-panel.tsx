import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { NotebookPen } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelRegistration } from "@/panels/panel-registry";
import { DraftsSourceProvider, useAllDrafts } from "@/drafts/context";
import { useHostDraftsSource } from "@/drafts/use-host-source";
import { useWorkspaceProjectLookup } from "@/drafts/workspaces";
import { DraftEditor } from "@/drafts/draft-editor";
import {
  dispatchesInto,
  draftDisplayTitle,
  isProjectLevelPlanFor,
  selectWorkspaceDraftSections,
  type ArtifactDetail,
  type WorkspaceProjectLookup,
} from "@/drafts/model";

const ThemedNotebookPen = withUnistyles(NotebookPen);

function useScratchpadDescriptor() {
  const { t } = useTranslation();
  return {
    label: t("drafts.panel.label"),
    subtitle: t("drafts.panel.subtitle"),
    tooltip: t("drafts.panel.tooltip"),
    titleState: "ready" as const,
    icon: ThemedNotebookPen,
    statusBucket: null,
  };
}

const DraftRow = memo(function DraftRow({
  artifact,
  isSelected,
  isSecondary,
  onSelect,
}: {
  artifact: ArtifactDetail;
  isSelected: boolean;
  isSecondary: boolean;
  onSelect: (artifactId: string) => void;
}) {
  const { t } = useTranslation();
  const title = draftDisplayTitle(artifact) ?? t("drafts.labels.untitled");
  const hasBeenSent = artifact.snapshots.length > 0;
  const onPress = useCallback(() => onSelect(artifact.id), [onSelect, artifact.id]);
  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.row,
      isSecondary && styles.rowSecondary,
      isSelected && styles.rowSelected,
      pressed && styles.pressed,
    ],
    [isSecondary, isSelected],
  );
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={rowStyle}>
      <View style={styles.rowHead}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {title}
        </Text>
      </View>
      <View style={styles.tagRow}>
        <Text style={styles.tag}>
          {hasBeenSent ? t("drafts.labels.unsentChanges") : t("drafts.labels.neverSent")}
        </Text>
        {isSecondary ? <Text style={styles.tag}>{t("drafts.labels.projectLevel")}</Text> : null}
      </View>
    </Pressable>
  );
});

/**
 * History is two lines rather than one truncated line: the draft's own name is
 * useless for recall without the session it became, and a narrow panel cannot
 * hold both on one row. Wrapping is the trade; shrinking the type is not.
 */
const HistoryRow = memo(function HistoryRow({
  artifact,
  workspaceId,
  lookup,
  onSelect,
}: {
  artifact: ArtifactDetail;
  workspaceId: string;
  lookup: WorkspaceProjectLookup;
  onSelect: (artifactId: string) => void;
}) {
  const { t } = useTranslation();
  const onPress = useCallback(() => onSelect(artifact.id), [onSelect, artifact.id]);
  const sent = dispatchesInto(artifact, workspaceId, lookup);
  const latest = sent.at(-1);
  if (!latest) return null;
  const title = draftDisplayTitle(artifact) ?? t("drafts.labels.untitled");
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={historyRowStyle}>
      <View style={styles.rowHead}>
        <Text numberOfLines={2} style={styles.rowTitle}>
          {title}
        </Text>
        <Text style={styles.rowRev}>{t("drafts.labels.revision", { rev: latest.rev })}</Text>
        {sent.length > 1 ? <Text style={styles.threadCount}>{`×${sent.length}`}</Text> : null}
      </View>
      <Text numberOfLines={2} style={styles.historyMeta}>
        {t("drafts.labels.sentToNewAgent")}
      </Text>
    </Pressable>
  );
});

function historyRowStyle({ pressed }: PressableStateCallbackType) {
  return [styles.historyRow, pressed && styles.pressed];
}

function newButtonStyle({ pressed }: PressableStateCallbackType) {
  return [styles.newButton, pressed && styles.pressed];
}

function ScratchpadPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "scratchpad", "ScratchpadPanel requires a scratchpad target");

  const source = useHostDraftsSource(serverId);
  const { artifacts } = useAllDrafts(source);
  const lookup = useWorkspaceProjectLookup();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const sections = useMemo(
    () => selectWorkspaceDraftSections({ artifacts, workspaceId, lookup }),
    [artifacts, workspaceId, lookup],
  );
  const selected = useMemo(
    () => artifacts.find((entry) => entry.id === selectedId) ?? null,
    [artifacts, selectedId],
  );

  // Creating from here plans the current workspace, because the plan follows
  // where the user is standing. A draft started in the global destination is not
  // standing anywhere and stays unplanned.
  const onCreate = useCallback(() => {
    const create = async () => {
      const created = await source.create({ planned: [{ kind: "workspace", workspaceId }] });
      setSelectedId(created.id);
    };
    void create();
  }, [source, workspaceId]);

  const onToggleHistory = useCallback(() => setIsHistoryOpen((open) => !open), []);

  return (
    <DraftsSourceProvider source={source}>
      <View testID="scratchpad-panel" style={styles.container}>
        <View style={styles.listPane}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t("drafts.sections.planned")}</Text>
            <View style={styles.spacer} />
            <Pressable
              accessibilityRole="button"
              testID="scratchpad-new-draft"
              onPress={onCreate}
              style={newButtonStyle}
            >
              <Text style={styles.newButtonLabel}>{t("drafts.actions.newDraft")}</Text>
            </Pressable>
          </View>

          <ScrollView>
            {sections.planned.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>{t("drafts.empty.plannedTitle")}</Text>
                <Text style={styles.emptyHint}>{t("drafts.empty.plannedHint")}</Text>
              </View>
            ) : (
              sections.planned.map((artifact) => (
                <DraftRow
                  key={artifact.id}
                  artifact={artifact}
                  isSelected={artifact.id === selectedId}
                  isSecondary={isProjectLevelPlanFor(artifact, workspaceId, lookup)}
                  onSelect={setSelectedId}
                />
              ))
            )}

            {sections.executed.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={onToggleHistory}
                style={styles.foldHead}
              >
                <Text style={styles.sectionTitle}>
                  {`${isHistoryOpen ? "▾" : "▸"} ${t("drafts.sections.ranHere")} (${sections.executed.length})`}
                </Text>
              </Pressable>
            ) : null}

            {isHistoryOpen
              ? sections.executed.map((artifact) => (
                  <HistoryRow
                    key={artifact.id}
                    artifact={artifact}
                    workspaceId={workspaceId}
                    lookup={lookup}
                    onSelect={setSelectedId}
                  />
                ))
              : null}
          </ScrollView>
        </View>

        <View style={styles.editorPane}>
          {selected ? (
            <DraftEditor key={selected.id} artifact={selected} serverId={serverId} />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyHint}>{t("drafts.empty.pickDraft")}</Text>
            </View>
          )}
        </View>
      </View>
    </DraftsSourceProvider>
  );
}

export const scratchpadPanelRegistration: PanelRegistration<"scratchpad"> = {
  kind: "scratchpad",
  resourceKey: () => "scratchpad",
  component: ScratchpadPanel,
  useDescriptor: useScratchpadDescriptor,
};

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1 },
  listPane: {
    maxHeight: "46%",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  editorPane: { flex: 1 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  foldHead: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  spacer: { flex: 1 },
  newButton: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0.5],
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.surface2,
  },
  newButtonLabel: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  row: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowSecondary: { opacity: 0.62 },
  rowSelected: { backgroundColor: theme.colors.surface2 },
  pressed: { opacity: 0.7 },
  rowHead: { flexDirection: "row", alignItems: "baseline", gap: theme.spacing[2] },
  rowTitle: { flex: 1, fontSize: theme.fontSize.base, color: theme.colors.foreground },
  rowVersion: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  rowRev: { fontSize: theme.fontSize.sm, color: theme.colors.accentBright },
  threadCount: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  tagRow: { flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[0.5] },
  tag: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  historyRow: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  historyMeta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    marginTop: theme.spacing[0.5],
  },
  emptyState: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    gap: theme.spacing[1],
  },
  emptyTitle: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
  emptyHint: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  editor: { flex: 1 },
  editorHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  editorTitle: { flex: 1, fontSize: theme.fontSize.base, color: theme.colors.foreground },
  saveChip: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  editorInput: {
    flex: 1,
    padding: theme.spacing[3],
    fontSize: theme.fontSize.content,
    color: theme.colors.foreground,
    textAlignVertical: "top",
  },
}));
