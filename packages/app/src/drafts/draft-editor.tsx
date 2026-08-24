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
import { DraftCheckpointStore } from "./checkpoint";
import { draftCheckpointStorage } from "./checkpoint-storage";
import { createDraftSaveLoop, type DraftSaveState } from "./save-loop";

/**
 * One store for the whole app. The checkpoints live under a single storage key
 * and a second store over the same key would clobber the first's writes.
 */
const checkpoints = new DraftCheckpointStore(draftCheckpointStorage);

const ThemedTextInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

/** Every state says something different. `saved` is never shown for text the
 * daemon does not have — that was the bug this whole seam exists to close. */
const SAVE_CHIP_KEY: Record<DraftSaveState["status"], string> = {
  saved: "drafts.editor.saved",
  saving: "drafts.editor.saving",
  unsaved: "drafts.editor.unsaved",
  conflict: "drafts.editor.conflict",
};

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
  const [saveState, setSaveState] = useState<DraftSaveState>({ status: "saved" });
  const [isSendOpen, setIsSendOpen] = useState(false);
  const [isPlanOpen, setIsPlanOpen] = useState(false);
  const [openRev, setOpenRev] = useState<number | null>(null);
  const [justSent, setJustSent] = useState<SendTarget | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // The loop owns everything about writing: the debounce, the coalescing, the
  // local checkpoint and what each failure means. It is a plain object so the
  // rules can be tested without a renderer — see `offline.test.ts`.
  const loop = useMemo(
    () =>
      createDraftSaveLoop({
        source,
        checkpoints,
        serverId,
        artifactId: artifact.id,
        version: artifact.version,
        onState: setSaveState,
      }),
    // Deliberately not `artifact.version`: the loop tracks the version itself
    // from here on, and rebuilding it mid-edit would drop queued text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, serverId, artifact.id],
  );

  useEffect(() => {
    void checkpoints.load();
  }, []);

  // A pending edit must not die with the component; write it on the way out. A
  // draft nobody wrote in is discarded on the same path, so opening the editor
  // and changing your mind leaves nothing behind.
  const artifactRef = useRef(artifact);
  artifactRef.current = artifact;
  useEffect(
    () => () => {
      if (loop.hasPendingText()) {
        void loop.flush();
      } else if (isDiscardableDraft(artifactRef.current)) {
        void source.discard(artifactRef.current.id);
      }
      loop.dispose();
    },
    [loop, source],
  );

  const onChangeText = loop.onChangeText;

  const onReloadRemote = useCallback(() => {
    if (saveState.status !== "conflict") return;
    void loop.reload(saveState.remote);
  }, [loop, saveState]);

  const onOverwriteRemote = useCallback(() => {
    if (saveState.status !== "conflict") return;
    void loop.overwrite(saveState.remote);
  }, [loop, saveState]);

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
      setSendError(null);
      const send = async () => {
        try {
          const result = await source.send({ artifactId: artifact.id, target });
          loop.noteVersion(result.artifact.version);
          setJustSent(target);
        } catch (error) {
          // A send that failed has to say so. The snapshot and a `failed`
          // dispatch are already on disk, so the lineage is right either way —
          // what was missing was the user finding out.
          setSendError(error instanceof Error ? error.message : String(error));
        }
      };
      void send();
    },
    [artifact.id, loop, source],
  );

  const dismissSent = useCallback(() => setJustSent(null), []);
  const dismissSendError = useCallback(() => setSendError(null), []);
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
        <Text style={saveState.status === "saved" ? styles.saveChip : styles.saveChipPending}>
          {t(SAVE_CHIP_KEY[saveState.status])}
        </Text>
      </View>

      {saveState.status === "conflict" ? (
        <View testID="draft-conflict" style={styles.conflictBar}>
          <Text style={styles.conflictText}>{t("drafts.conflict.message")}</Text>
          <Pressable
            accessibilityRole="button"
            testID="draft-conflict-reload"
            onPress={onReloadRemote}
            style={chipStyle}
          >
            <Text style={styles.chipLabel}>{t("drafts.conflict.reload")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            testID="draft-conflict-overwrite"
            onPress={onOverwriteRemote}
            style={chipStyle}
          >
            <Text style={styles.chipLabel}>{t("drafts.conflict.overwrite")}</Text>
          </Pressable>
        </View>
      ) : null}

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
        testID="draft-body"
        initialValue={artifact.body}
        onChangeText={onChangeText}
        placeholder={t("drafts.editor.bodyPlaceholder")}
        style={styles.input}
      />

      {sendError !== null ? (
        <View testID="draft-send-error" style={styles.sendErrorBar}>
          <Text style={styles.sendErrorText}>{t("drafts.sent.failed", { error: sendError })}</Text>
          <Pressable accessibilityRole="button" onPress={dismissSendError} style={chipStyle}>
            <Text style={styles.chipLabel}>{t("drafts.sent.dismiss")}</Text>
          </Pressable>
        </View>
      ) : null}

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
  saveChipPending: { fontSize: theme.fontSize.sm, color: theme.colors.statusWarning },
  conflictBar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  conflictText: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  sendErrorBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  sendErrorText: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.statusDanger },
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
