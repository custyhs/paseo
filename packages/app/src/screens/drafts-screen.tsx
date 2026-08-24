import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { SearchField } from "@/components/ui/search-field";
import {
  DraftsSourceProvider,
  useDraftSearch,
  useDraftsAcrossHosts,
  type HostedDraft,
} from "@/drafts/context";
import { useDraftHosts } from "@/drafts/use-host-source";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker-constants";
import { useHosts } from "@/runtime/host-runtime";
import { DraftEditor } from "@/drafts/draft-editor";
import { draftDisplayTitle, plannedTargetKey, type ArtifactDetail } from "@/drafts/model";
import { describeWorkspace, useAllWorkspaces } from "@/drafts/workspaces";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";

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

function rowStyleFor(isSelected: boolean) {
  return ({ pressed }: PressableStateCallbackType) => [
    styles.row,
    isSelected && styles.rowSelected,
    pressed && styles.pressed,
  ];
}

/**
 * Hover reveal follows `docs/hover.md` exactly: the tracker is a plain `View`
 * with pointer events, the press lives on a separate inner `Pressable`, and the
 * revealed control sits inside so crossing onto it never fires `pointerleave`.
 * Pointer events do not fire on native, so the control is simply always there
 * on native and on compact.
 */
const DraftListRow = memo(function DraftListRow({
  artifact,
  isSelected,
  planLabels,
  matchedRev,
  onSelect,
  onToggleArchived,
}: {
  artifact: ArtifactDetail;
  isSelected: boolean;
  planLabels: string[];
  /** Set when the query matched only an older revision, not the current text. */
  matchedRev: number | null;
  onSelect: (artifactId: string) => void;
  onToggleArchived: (artifactId: string) => void;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const onPointerEnter = useCallback(() => setIsHovered(true), []);
  const onPointerLeave = useCallback(() => setIsHovered(false), []);
  const onPress = useCallback(() => onSelect(artifact.id), [onSelect, artifact.id]);
  const onArchive = useCallback(
    () => onToggleArchived(artifact.id),
    [onToggleArchived, artifact.id],
  );
  const style = useMemo(() => rowStyleFor(isSelected), [isSelected]);
  const snippet = artifact.body.trim().replace(/\s+/g, " ").slice(0, 120);
  const isArchived = artifact.archivedAt !== null;
  const showArchive = isHovered || isNative || isCompact;

  return (
    <View
      style={styles.rowHoverTracker}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <Pressable accessibilityRole="button" onPress={onPress} style={style}>
        <View style={styles.rowHead}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {draftDisplayTitle(artifact) ?? t("drafts.labels.untitled")}
          </Text>
          {showArchive ? (
            <Pressable
              accessibilityRole="button"
              testID={`draft-archive-${artifact.id}`}
              onPress={onArchive}
              style={archiveButtonStyle}
            >
              <Text style={styles.archiveLabel}>
                {t(isArchived ? "drafts.actions.unarchive" : "drafts.actions.archive")}
              </Text>
            </Pressable>
          ) : null}
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
          {matchedRev !== null ? (
            <Text style={styles.matchTag}>
              {t("drafts.list.matchedInRevision", { rev: matchedRev })}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
});

function archiveButtonStyle({ pressed }: PressableStateCallbackType) {
  return [styles.archiveButton, pressed && styles.pressed];
}

function newButtonStyle({ pressed }: PressableStateCallbackType) {
  return [styles.newButton, pressed && styles.pressed];
}

export function DraftsScreen() {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const workspaces = useAllWorkspaces();
  const draftHosts = useDraftHosts();
  const hostProfiles = useHosts();
  const { drafts } = useDraftsAcrossHosts(draftHosts);
  const [search, setSearch] = useState("");
  const searchHits = useDraftSearch(draftHosts, search);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A draft belongs to the daemon that stores it, so the filter narrows the
  // list rather than switching which host is connected.
  const [hostFilter, setHostFilter] = useState<string>(ALL_HOSTS_OPTION_ID);

  const visibleHosts = useMemo(
    () =>
      hostFilter === ALL_HOSTS_OPTION_ID
        ? draftHosts
        : draftHosts.filter((host) => host.serverId === hostFilter),
    [draftHosts, hostFilter],
  );
  // Creating needs one host. With a filter on it is that one; with "all hosts"
  // and several connected it is the first, which is arbitrary — the row shows
  // which host a draft landed on so the choice is at least visible.
  const createHost = visibleHosts[0] ?? draftHosts[0] ?? null;

  const labelFor = useCallback(
    (artifact: ArtifactDetail) =>
      artifact.planned.map((target) => {
        for (const workspace of workspaces) {
          if (target.kind === "workspace" && workspace.id === target.workspaceId) {
            return describeWorkspace(workspace);
          }
          if (target.kind === "project" && workspace.projectId === target.projectId) {
            return workspace.projectDisplayName;
          }
        }
        return plannedTargetKey(target);
      }),
    [workspaces],
  );

  /**
   * When a query is running, the daemon decides which drafts match — it is the
   * only side that can see revisions the draft no longer contains. A draft that
   * matched only in an old revision is marked, so the row explains itself rather
   * than looking like a false positive.
   */
  const matched = useMemo(() => {
    if (!search.trim()) return null;
    const byArtifact = new Map<string, number | null>();
    for (const { serverId, hit } of searchHits) {
      const key = `${serverId}:${hit.artifactId}`;
      const rev = hit.where.kind === "snapshot" ? hit.where.rev : null;
      // A current-text hit outranks an old-revision one: the words are still there.
      if (rev === null || !byArtifact.has(key)) byArtifact.set(key, rev);
    }
    return byArtifact;
  }, [search, searchHits]);

  const isMatch = useCallback(
    (entry: HostedDraft) =>
      matched === null || matched.has(`${entry.serverId}:${entry.artifact.id}`),
    [matched],
  );
  const matchedRev = useCallback(
    (entry: HostedDraft) => matched?.get(`${entry.serverId}:${entry.artifact.id}`) ?? null,
    [matched],
  );

  const groups = useMemo(() => {
    const allowed = new Set(visibleHosts.map((host) => host.serverId));
    const visible = drafts
      .filter(
        (entry) =>
          allowed.has(entry.serverId) && entry.artifact.archivedAt === null && isMatch(entry),
      )
      .sort((left, right) => right.artifact.updatedAt.localeCompare(left.artifact.updatedAt));
    const byDay = new Map<string, HostedDraft[]>();
    for (const entry of visible) {
      const key = dayKey(entry.artifact.updatedAt);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(entry);
      else byDay.set(key, [entry]);
    }
    return [...byDay.entries()];
  }, [drafts, isMatch, visibleHosts]);

  /**
   * Archived drafts stay out of the everyday list but are reachable by search,
   * grouped on their own at the bottom (ADR-0005 decision 4). Excluding them
   * entirely teaches the user the draft is gone rather than filed.
   */
  const archivedMatches = useMemo(() => {
    if (!search.trim()) return [];
    const allowed = new Set(visibleHosts.map((host) => host.serverId));
    return drafts
      .filter(
        (entry) =>
          allowed.has(entry.serverId) && entry.artifact.archivedAt !== null && isMatch(entry),
      )
      .sort((left, right) => right.artifact.updatedAt.localeCompare(left.artifact.updatedAt));
  }, [drafts, isMatch, search, visibleHosts]);

  const selected = useMemo(
    () => drafts.find((entry) => entry.artifact.id === selectedId) ?? null,
    [drafts, selectedId],
  );

  const onCreate = useCallback(() => {
    // Created here, so planned nowhere: a draft started in the global home is
    // not standing in any workspace, and pretending otherwise would put it in a
    // scratchpad the user never opened.
    if (!createHost) return;
    const create = async () => {
      const created = await createHost.source.create();
      setSelectedId(created.id);
    };
    void create();
  }, [createHost]);

  const onToggleArchived = useCallback(
    (artifactId: string) => {
      const owner = drafts.find((entry) => entry.artifact.id === artifactId);
      if (!owner) return;
      void owner.source.setArchived({
        artifactId,
        archived: owner.artifact.archivedAt === null,
      });
    },
    [drafts],
  );

  const list = (
    <View style={styles.listPane}>
      {hostProfiles.length > 1 ? (
        <View style={styles.hostRow}>
          <HostFilter
            hosts={hostProfiles}
            selectedHost={hostFilter}
            onSelectHost={setHostFilter}
            triggerTestID="drafts-host-filter"
          />
        </View>
      ) : null}
      <View style={styles.filterRow}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          testID="drafts-search"
          placeholder={t("drafts.list.searchPlaceholder")}
          clearAccessibilityLabel={t("drafts.list.clearSearch")}
        />
        <Pressable
          accessibilityRole="button"
          testID="drafts-new-draft"
          onPress={onCreate}
          style={newButtonStyle}
        >
          <Text style={styles.newButtonLabel}>{t("drafts.actions.newDraft")}</Text>
        </Pressable>
      </View>
      <ScrollView testID="drafts-list">
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
              {entries.map((entry) => (
                <DraftListRow
                  key={`${entry.serverId}:${entry.artifact.id}`}
                  artifact={entry.artifact}
                  isSelected={entry.artifact.id === selectedId}
                  planLabels={labelFor(entry.artifact)}
                  matchedRev={matchedRev(entry)}
                  onSelect={setSelectedId}
                  onToggleArchived={onToggleArchived}
                />
              ))}
            </View>
          ))
        )}
        {archivedMatches.length > 0 ? (
          <View testID="drafts-archived-group">
            <Text style={styles.daySeparator}>{t("drafts.list.archivedGroup")}</Text>
            {archivedMatches.map((entry) => (
              <DraftListRow
                key={`${entry.serverId}:${entry.artifact.id}`}
                artifact={entry.artifact}
                isSelected={entry.artifact.id === selectedId}
                planLabels={labelFor(entry.artifact)}
                matchedRev={matchedRev(entry)}
                onSelect={setSelectedId}
                onToggleArchived={onToggleArchived}
              />
            ))}
          </View>
        ) : null}
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
        <DraftsSourceProvider source={selected.source}>
          <DraftEditor
            key={`${selected.serverId}:${selected.artifact.id}`}
            artifact={selected.artifact}
            serverId={selected.serverId}
          />
        </DraftsSourceProvider>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyHint}>{t("drafts.empty.pickDraft")}</Text>
        </View>
      )}
    </View>
  );

  // The editor and its sheets take the selected draft's own host, supplied
  // around the editor rather than around the screen: with several hosts there is
  // no single source the whole screen could use.
  return (
    <View testID="drafts-screen" style={styles.container}>
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
  // Fixed height so the archive control swapping in never moves the row —
  // failure mode 2 in `docs/hover.md`.
  rowHoverTracker: { position: "relative", minHeight: 64 },
  archiveButton: {
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: theme.spacing[0.5],
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  archiveLabel: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  matchTag: { fontSize: theme.fontSize.sm, color: theme.colors.accentBright },
  hostRow: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
  },
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
