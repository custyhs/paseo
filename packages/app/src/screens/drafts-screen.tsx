import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { SearchField } from "@/components/ui/search-field";
import { useAllDrafts, useDraftsSource } from "@/drafts/context";
import { DraftEditor } from "@/drafts/draft-editor";
import { draftDisplayTitle, plannedTargetKey, type ArtifactDetail } from "@/drafts/model";
import { useSessionStore } from "@/stores/session-store";
import { useIsCompactFormFactor } from "@/constants/layout";

/**
 * The global home for drafts. Grouping is by day and location is a filter, which
 * is how History already answers the same question — and it keeps a draft to one
 * row no matter how many places it is planned for. Grouping by location would
 * duplicate rows and re-answer, worse, the question the scratchpad already
 * answers per workspace.
 */

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function matchesSearch(artifact: ArtifactDetail, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const haystack = `${artifact.title ?? ""}\n${artifact.body}`.toLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function rowStyleFor(isSelected: boolean) {
  return ({ pressed }: PressableStateCallbackType) => [
    styles.row,
    isSelected && styles.rowSelected,
    pressed && styles.pressed,
  ];
}

const DraftListRow = memo(function DraftListRow({
  artifact,
  isSelected,
  planLabels,
  onSelect,
}: {
  artifact: ArtifactDetail;
  isSelected: boolean;
  planLabels: string[];
  onSelect: (artifactId: string) => void;
}) {
  const { t } = useTranslation();
  const onPress = useCallback(() => onSelect(artifact.id), [onSelect, artifact.id]);
  const style = useMemo(() => rowStyleFor(isSelected), [isSelected]);
  const snippet = artifact.body.trim().replace(/\s+/g, " ").slice(0, 120);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={style}>
      <View style={styles.rowHead}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {draftDisplayTitle(artifact) ?? t("drafts.labels.untitled")}
        </Text>
      </View>
      {snippet ? (
        <Text numberOfLines={1} style={styles.rowSnippet}>
          {snippet}
        </Text>
      ) : null}
      <View style={styles.tagRow}>
        {planLabels.length === 0 ? (
          <Text style={styles.tag}>{t("drafts.labels.unplanned")}</Text>
        ) : (
          planLabels.map((label) => (
            <Text key={label} style={styles.tag}>
              {label}
            </Text>
          ))
        )}
        {artifact.dispatches.length > 0 ? (
          <Text style={styles.sentTag}>
            {t("drafts.labels.sentCount", { count: artifact.dispatches.length })}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

function newButtonStyle({ pressed }: PressableStateCallbackType) {
  return [styles.newButton, pressed && styles.pressed];
}

export function DraftsScreen() {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const sessions = useSessionStore((state) => state.sessions);
  const serverId = useMemo(() => Object.keys(sessions)[0] ?? "", [sessions]);
  const source = useDraftsSource();
  const { artifacts } = useAllDrafts(source);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const labelFor = useCallback(
    (artifact: ArtifactDetail) =>
      artifact.planned.map((target) => {
        for (const session of Object.values(sessions)) {
          for (const workspace of Object.values(session.workspaces ?? {})) {
            if (target.kind === "workspace" && workspace.id === target.workspaceId) {
              return `${workspace.projectDisplayName} · ${workspace.name}`;
            }
            if (target.kind === "project" && workspace.projectId === target.projectId) {
              return workspace.projectDisplayName;
            }
          }
        }
        return plannedTargetKey(target);
      }),
    [sessions],
  );

  const groups = useMemo(() => {
    const visible = artifacts
      .filter((artifact) => artifact.archivedAt === null && matchesSearch(artifact, search))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const byDay = new Map<string, ArtifactDetail[]>();
    for (const artifact of visible) {
      const key = dayKey(artifact.updatedAt);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(artifact);
      else byDay.set(key, [artifact]);
    }
    return [...byDay.entries()];
  }, [artifacts, search]);

  const selected = useMemo(
    () => artifacts.find((entry) => entry.id === selectedId) ?? null,
    [artifacts, selectedId],
  );

  const onCreate = useCallback(() => {
    // Created here, so planned nowhere: a draft started in the global home is
    // not standing in any workspace, and pretending otherwise would put it in a
    // scratchpad the user never opened.
    const create = async () => {
      const created = await source.create();
      setSelectedId(created.id);
    };
    void create();
  }, [source]);

  const list = (
    <View style={styles.listPane}>
      <View style={styles.filterRow}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t("drafts.list.searchPlaceholder")}
          clearAccessibilityLabel={t("drafts.list.clearSearch")}
        />
        <Pressable accessibilityRole="button" onPress={onCreate} style={newButtonStyle}>
          <Text style={styles.newButtonLabel}>{t("drafts.actions.newDraft")}</Text>
        </Pressable>
      </View>
      <ScrollView>
        {groups.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyHint}>
              {search ? t("drafts.list.noMatches") : t("drafts.list.empty")}
            </Text>
          </View>
        ) : (
          groups.map(([day, entries]) => (
            <View key={day}>
              <Text style={styles.daySeparator}>{day}</Text>
              {entries.map((artifact) => (
                <DraftListRow
                  key={artifact.id}
                  artifact={artifact}
                  isSelected={artifact.id === selectedId}
                  planLabels={labelFor(artifact)}
                  onSelect={setSelectedId}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );

  // Compact shows one at a time; a wide window shows the list beside the editor,
  // and keeps the editor pane present so picking a draft does not shift the layout.
  const showList = !isCompact || selected === null;
  const showEditor = !isCompact || selected !== null;
  const editorPane = (
    <View style={styles.editorPane}>
      {selected ? (
        <DraftEditor key={selected.id} artifact={selected} serverId={serverId} />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyHint}>{t("drafts.empty.pickDraft")}</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <MenuHeader title={t("drafts.list.title")} />
      <View style={isCompact ? styles.bodyCompact : styles.body}>
        {showList ? list : null}
        {showEditor ? editorPane : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
  body: { flex: 1, flexDirection: "row" },
  bodyCompact: { flex: 1 },
  listPane: {
    width: 320,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  editorPane: { flex: 1 },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  newButton: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.surface2,
  },
  newButtonLabel: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  daySeparator: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  row: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowSelected: { backgroundColor: theme.colors.surface2 },
  pressed: { opacity: 0.7 },
  rowHead: { flexDirection: "row", alignItems: "baseline", gap: theme.spacing[2] },
  rowTitle: { flex: 1, fontSize: theme.fontSize.base, color: theme.colors.foreground },
  rowVersion: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  rowSnippet: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    marginTop: theme.spacing[0.5],
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  tag: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  sentTag: { fontSize: theme.fontSize.sm, color: theme.colors.accentBright },
  emptyState: { padding: theme.spacing[4] },
  emptyHint: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
