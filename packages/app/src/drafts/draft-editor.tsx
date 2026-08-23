import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { EditingTextInput } from "@/components/ui/text-input";
import { useDraftsSource } from "./context";
import {
  draftDisplayTitle,
  isDiscardableDraft,
  plannedTargetKey,
  type ArtifactDetail,
  type PlannedTarget,
} from "./model";
import { PlanSheet } from "./plan-sheet";
import {
  describeWorkspace,
  useAllWorkspaces,
  useServerAgents,
  type DraftAgentOption,
} from "./workspaces";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { SendSheet } from "./send-sheet";
import { SnapshotSheet } from "./snapshot-sheet";
import type { SendTarget } from "./source";

/** Matches `DRAFT_PERSIST_INTERVAL_MS`, the composer's own checkpoint cadence. */
const DRAFT_WRITE_DEBOUNCE_MS = 200;

const ThemedTextInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

function pressed({ pressed: isPressed }: PressableStateCallbackType) {
  return isPressed ? styles.pressed : null;
}

function chipStyle({ pressed: isPressed }: PressableStateCallbackType) {
  return [styles.chip, isPressed && styles.pressed];
}

function addChipStyle({ pressed: isPressed }: PressableStateCallbackType) {
  return [styles.chip, styles.addChip, isPressed && styles.pressed];
}

function sendButtonStyle({ pressed: isPressed }: PressableStateCallbackType) {
  return [styles.sendButton, isPressed && styles.pressed];
}

function usePlannedLabel(): (target: PlannedTarget) => string {
  const workspaces = useAllWorkspaces();
  return useCallback(
    (target: PlannedTarget) => {
      for (const workspace of workspaces) {
        if (target.kind === "workspace" && workspace.id === target.workspaceId) {
          return describeWorkspace(workspace);
        }
        if (target.kind === "project" && workspace.projectId === target.projectId) {
          return workspace.projectDisplayName;
        }
      }
      return target.kind === "workspace" ? target.workspaceId : target.projectId;
    },
    [workspaces],
  );
}

const PlanChip = memo(function PlanChip({
  target,
  label,
  onRemove,
}: {
  target: PlannedTarget;
  label: string;
  onRemove: (target: PlannedTarget) => void;
}) {
  const { t } = useTranslation();
  const onPress = useCallback(() => onRemove(target), [onRemove, target]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("drafts.actions.removePlan", { target: label })}
      onPress={onPress}
      style={chipStyle}
    >
      <Text style={styles.chipLabel}>{`${target.kind === "project" ? "◆" : "▣"} ${label} ×`}</Text>
    </Pressable>
  );
});

const LineageRow = memo(function LineageRow({
  rev,
  count,
  onOpen,
}: {
  rev: number;
  count: number;
  onOpen: (rev: number) => void;
}) {
  const { t } = useTranslation();
  const onPress = useCallback(() => onOpen(rev), [onOpen, rev]);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={pressed}>
      <Text style={styles.lineageRow}>
        {t("drafts.labels.revision", { rev })}
        {count > 1 ? ` ×${count}` : ""}
      </Text>
    </Pressable>
  );
});

function sentRowStyle({ pressed: isPressed }: PressableStateCallbackType) {
  return [styles.sentRow, isPressed && styles.pressed];
}

/**
 * Says the send happened and where it went, and gets out of the way. It is the
 * only feedback that a revision left the editor — the lineage strip lists every
 * dispatch equally and cannot single out the one that just occurred.
 */
const SentConfirmation = memo(function SentConfirmation({
  target,
  agents,
  onOpen,
  onDismiss,
}: {
  target: SendTarget;
  agents: DraftAgentOption[];
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const agent =
    target.kind === "existing_agent"
      ? agents.find((entry) => entry.id === target.agentId)
      : undefined;
  const label = agent
    ? t("drafts.sent.toAgent", { title: agent.title ?? agent.provider })
    : t("drafts.sent.toNewAgent");

  return (
    <View style={styles.sentBar}>
      <Pressable
        accessibilityRole="button"
        testID="draft-sent-confirmation"
        onPress={onOpen}
        disabled={!agent}
        style={sentRowStyle}
      >
        <Text style={styles.sentLabel}>{label}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("drafts.sent.dismiss")}
        testID="draft-sent-dismiss"
        onPress={onDismiss}
        style={pressed}
      >
        <Text style={styles.sentDismiss}>×</Text>
      </Pressable>
    </View>
  );
});

/**
 * The editor both surfaces share. A and C are two views of one store, so they
 * have to be one component — otherwise the two would drift and "same draft,
 * different places" would stop being true in the details that matter.
 */
export function DraftEditor({
  artifact,
  serverId,
}: {
  artifact: ArtifactDetail;
  serverId: string;
}) {
  const { t } = useTranslation();
  const source = useDraftsSource();
  const plannedLabel = usePlannedLabel();
  const agents = useServerAgents(serverId);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendOpen, setIsSendOpen] = useState(false);
  const [isPlanOpen, setIsPlanOpen] = useState(false);
  const [openRev, setOpenRev] = useState<number | null>(null);
  const [justSent, setJustSent] = useState<SendTarget | null>(null);

  const versionRef = useRef(artifact.version);
  const latestTextRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Writes coalesce behind one in-flight save. One request per keystroke races
  // the optimistic-concurrency check and every write after the first carries a
  // stale base version, so characters would be dropped rather than saved.
  const flush = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsSaving(true);
    try {
      while (latestTextRef.current !== null) {
        const body = latestTextRef.current;
        latestTextRef.current = null;
        const saved = await source.update({
          artifactId: artifact.id,
          baseVersion: versionRef.current,
          body,
        });
        versionRef.current = saved.version;
      }
    } finally {
      inFlightRef.current = false;
      setIsSaving(false);
    }
  }, [artifact.id, source]);

  // A pause, not a keystroke, is what earns a write. `version` is the
  // optimistic-concurrency token, so one write per character makes it climb by
  // hundreds while typing a paragraph — noise that also buries the numbers that
  // do mean something, the revisions that were actually sent. The interval
  // matches the composer's own checkpoint cadence.
  const onChangeText = useCallback(
    (next: string) => {
      latestTextRef.current = next;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, DRAFT_WRITE_DEBOUNCE_MS);
    },
    [flush],
  );

  // A pending edit must not die with the component; flush it on the way out. A
  // draft nobody wrote in is discarded on the same path, so opening the editor
  // and changing your mind leaves nothing behind.
  const artifactRef = useRef(artifact);
  artifactRef.current = artifact;
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (latestTextRef.current !== null) {
        void flush();
        return;
      }
      if (isDiscardableDraft(artifactRef.current)) {
        void source.discard(artifactRef.current.id);
      }
    },
    [flush, source],
  );

  const onRemovePlan = useCallback(
    (target: PlannedTarget) => {
      const key = plannedTargetKey(target);
      const next = artifact.planned.filter((entry) => plannedTargetKey(entry) !== key);
      void source.setPlanned({ artifactId: artifact.id, planned: next });
    },
    [artifact.id, artifact.planned, source],
  );

  const onAddPlan = useCallback(
    (target: PlannedTarget) => {
      const key = plannedTargetKey(target);
      if (artifact.planned.some((entry) => plannedTargetKey(entry) === key)) {
        setIsPlanOpen(false);
        return;
      }
      void source.setPlanned({ artifactId: artifact.id, planned: [...artifact.planned, target] });
      setIsPlanOpen(false);
    },
    [artifact.id, artifact.planned, source],
  );

  // Sending does not navigate: the draft stays open so the next revision can be
  // written, or sent somewhere else. A confirmation row carries the only thing
  // the lineage strip cannot say on its own — that this just happened, and where
  // it went — and it is the way through to that session for anyone who wants it.
  const onSend = useCallback(
    (target: SendTarget) => {
      setIsSendOpen(false);
      const send = async () => {
        const result = await source.send({ artifactId: artifact.id, target });
        versionRef.current = result.artifact.version;
        setJustSent(target);
      };
      void send();
    },
    [artifact.id, source],
  );

  const dismissSent = useCallback(() => setJustSent(null), []);
  const openSentAgent = useCallback(() => {
    if (justSent?.kind !== "existing_agent") return;
    navigateToAgent({ serverId, agentId: justSent.agentId });
  }, [justSent, serverId]);

  const openSend = useCallback(() => setIsSendOpen(true), []);
  const closeSend = useCallback(() => setIsSendOpen(false), []);
  const openPlan = useCallback(() => setIsPlanOpen(true), []);
  const closePlan = useCallback(() => setIsPlanOpen(false), []);
  const closeSnapshot = useCallback(() => setOpenRev(null), []);

  // One row per revision, not per dispatch: sending the same revision twice is
  // one idea reaching two places, and listing it twice reads as two ideas.
  const lineage = useMemo(() => {
    const counts = new Map<number, number>();
    for (const dispatch of artifact.dispatches) {
      counts.set(dispatch.rev, (counts.get(dispatch.rev) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([rev, count]) => ({ rev, count }))
      .sort((left, right) => right.rev - left.rev);
  }, [artifact.dispatches]);

  return (
    <View testID="draft-editor" style={styles.container}>
      <View style={styles.head}>
        <Text numberOfLines={1} style={styles.title}>
          {draftDisplayTitle(artifact) ?? t("drafts.labels.untitled")}
        </Text>
        <Text style={styles.saveChip}>
          {isSaving ? t("drafts.editor.saving") : t("drafts.editor.saved")}
        </Text>
      </View>

      <View style={styles.planRow}>
        <Text style={styles.planLabel}>{t("drafts.labels.plannedIn")}</Text>
        {artifact.planned.length === 0 ? (
          <Text style={styles.planEmpty}>{t("drafts.labels.noPlan")}</Text>
        ) : (
          artifact.planned.map((target) => (
            <PlanChip
              key={plannedTargetKey(target)}
              target={target}
              label={plannedLabel(target)}
              onRemove={onRemovePlan}
            />
          ))
        )}
        <Pressable
          accessibilityRole="button"
          testID="draft-add-plan"
          onPress={openPlan}
          style={addChipStyle}
        >
          <Text style={styles.chipLabel}>{`+ ${t("drafts.actions.addPlan")}`}</Text>
        </Pressable>
      </View>

      <ThemedTextInput
        multiline
        initialValue={artifact.body}
        onChangeText={onChangeText}
        placeholder={t("drafts.editor.bodyPlaceholder")}
        style={styles.input}
      />

      {justSent ? (
        <SentConfirmation
          target={justSent}
          agents={agents}
          onOpen={openSentAgent}
          onDismiss={dismissSent}
        />
      ) : null}

      {lineage.length > 0 ? (
        <View style={styles.lineage}>
          <Text style={styles.planLabel}>{t("drafts.sections.lineage")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {lineage.map((entry) => (
              <LineageRow key={entry.rev} rev={entry.rev} count={entry.count} onOpen={setOpenRev} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.foot}>
        <Pressable accessibilityRole="button" onPress={openSend} style={sendButtonStyle}>
          <Text style={styles.sendLabel}>{t("drafts.actions.send")}</Text>
        </Pressable>
        <View style={styles.spacer} />
        <Text style={styles.version}>
          {t("drafts.labels.version", { version: artifact.version })}
        </Text>
      </View>

      <SendSheet
        artifact={artifact}
        serverId={serverId}
        visible={isSendOpen}
        onClose={closeSend}
        onSend={onSend}
      />
      <PlanSheet visible={isPlanOpen} onClose={closePlan} onSelect={onAddPlan} />
      <SnapshotSheet artifact={artifact} rev={openRev} onClose={closeSnapshot} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: { flex: 1, fontSize: theme.fontSize.base, color: theme.colors.foreground },
  saveChip: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  planLabel: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  planEmpty: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  chip: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0.5],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
  },
  addChip: { borderStyle: "dashed" },
  chipLabel: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  pressed: { opacity: 0.7 },
  input: {
    flex: 1,
    padding: theme.spacing[3],
    fontSize: theme.fontSize.content,
    color: theme.colors.foreground,
    textAlignVertical: "top",
  },
  lineage: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  lineageRow: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.accentBright,
    marginRight: theme.spacing[3],
  },
  sentBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  sentRow: { flex: 1 },
  sentLabel: { fontSize: theme.fontSize.sm, color: theme.colors.accentBright },
  sentDismiss: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[1],
  },
  foot: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  spacer: { flex: 1 },
  sendButton: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.accent,
  },
  sendLabel: { fontSize: theme.fontSize.sm, color: theme.colors.accentForeground },
  version: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
