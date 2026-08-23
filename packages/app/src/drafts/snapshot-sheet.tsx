import { useMemo } from "react";
import { ScrollView, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import type { ArtifactDetail } from "./model";

/**
 * Shows what an agent actually received.
 *
 * This reads `snapshot.body` and never `artifact.body`. Rendering the live text
 * here would quietly turn the feature into a lie: the whole reason snapshots
 * exist is that the draft keeps changing after it is sent.
 */
export function SnapshotSheet({
  artifact,
  rev,
  onClose,
}: {
  artifact: ArtifactDetail;
  rev: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const snapshot = useMemo(
    () => (rev === null ? null : (artifact.snapshots.find((entry) => entry.rev === rev) ?? null)),
    [artifact.snapshots, rev],
  );
  const dispatch = useMemo(
    () =>
      rev === null ? null : (artifact.dispatches.findLast((entry) => entry.rev === rev) ?? null),
    [artifact.dispatches, rev],
  );

  const header = useMemo(
    () => ({
      title: t("drafts.snapshot.title", { rev: rev ?? 0 }),
      subtitle: dispatch
        ? t("drafts.snapshot.subtitle", { clientMessageId: dispatch.clientMessageId })
        : undefined,
    }),
    [t, rev, dispatch],
  );

  return (
    <AdaptiveModalSheet header={header} visible={snapshot !== null} onClose={onClose} scrollable>
      <Text style={styles.immutable}>{t("drafts.snapshot.immutable")}</Text>
      <ScrollView>
        <Text selectable style={styles.body}>
          {snapshot?.body ?? ""}
        </Text>
      </ScrollView>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  immutable: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    marginBottom: theme.spacing[2],
  },
  body: {
    fontSize: theme.fontSize.content,
    color: theme.colors.foreground,
    lineHeight: 22,
  },
}));
