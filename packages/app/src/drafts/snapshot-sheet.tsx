import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useDraftsSource } from "./context";
import type { ArtifactDetail, ArtifactSnapshot } from "./model";

/**
 * Shows what an agent actually received.
 *
 * This reads `snapshot.body` and never `artifact.body`. Rendering the live text
 * here would quietly turn the feature into a lie: the whole reason snapshots
 * exist is that the draft keeps changing after it is sent.
 *
 * The body is fetched when the row is opened rather than carried on the draft.
 * A spec sent twenty times is twenty copies of its text, and none of them is
 * wanted until someone asks for that one (ADR-0002). They never change, so the
 * source is free to answer from memory the second time.
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
  const source = useDraftsSource();
  const [snapshot, setSnapshot] = useState<ArtifactSnapshot | null>(null);
  const [isMissing, setIsMissing] = useState(false);

  useEffect(() => {
    if (rev === null) {
      setSnapshot(null);
      setIsMissing(false);
      return;
    }
    let cancelled = false;
    setSnapshot(null);
    setIsMissing(false);
    const load = async () => {
      try {
        const found = await source.getSnapshot({ artifactId: artifact.id, rev });
        if (cancelled) return;
        setSnapshot(found);
        setIsMissing(found === null);
      } catch {
        // A revision that cannot be read is reported as such rather than as an
        // empty body, which would read as "this is what was sent".
        if (!cancelled) setIsMissing(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [artifact.id, rev, source]);
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
    // Opens on the row, not on the body arriving. Waiting for the fetch before
    // showing anything reads as the row being dead.
    <AdaptiveModalSheet header={header} visible={rev !== null} onClose={onClose} scrollable>
      <Text style={styles.immutable}>{t("drafts.snapshot.immutable")}</Text>
      <ScrollView>
        {snapshot ? (
          <Text selectable style={styles.body}>
            {snapshot.body}
          </Text>
        ) : (
          <Text style={styles.pending}>
            {t(isMissing ? "drafts.snapshot.missing" : "drafts.snapshot.loading")}
          </Text>
        )}
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
  pending: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
