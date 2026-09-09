"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, SelectField } from "@omnistudio/ui";
import type { SourceEpisode } from "@/lib/api";
import styles from "./SourceEpisodePanel.module.css";

export interface SourceEpisodePanelProps {
  /** Episodes that already point at this source document. */
  linkedEpisodes: readonly SourceEpisode[];
  /** Episodes that can be linked from this source document. */
  availableEpisodes: readonly SourceEpisode[];
  /** Disables all relation mutations while the parent is refreshing. */
  busy?: boolean;
  onLink: (episodeId: string) => void | Promise<void>;
  onUnlink: (episodeId: string) => void | Promise<void>;
}

function episodeLabel(episode: SourceEpisode): string {
  if (episode.episode_number == null) return episode.title;
  return `EP.${String(episode.episode_number).padStart(2, "0")} · ${episode.title}`;
}

export default function SourceEpisodePanel({ linkedEpisodes, availableEpisodes, busy = false, onLink, onUnlink }: SourceEpisodePanelProps) {
  const t = useTranslations("sourceWorkspace");
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>(availableEpisodes[0]?.id || "");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!availableEpisodes.some(episode => episode.id === selectedEpisodeId)) {
      setSelectedEpisodeId(availableEpisodes[0]?.id || "");
    }
  }, [availableEpisodes, selectedEpisodeId]);

  const options = useMemo(
    () => availableEpisodes.map(episode => ({ id: episode.id, label: episodeLabel(episode), description: episode.status || undefined })),
    [availableEpisodes],
  );
  const relationBusy = busy || pendingAction !== null;

  const linkSelected = async () => {
    if (!selectedEpisodeId || relationBusy) return;
    setActionError(null);
    setPendingAction(`link:${selectedEpisodeId}`);
    try {
      await onLink(selectedEpisodeId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("linkFailed"));
    } finally {
      setPendingAction(null);
    }
  };

  const unlinkEpisode = async (episodeId: string) => {
    if (relationBusy) return;
    setActionError(null);
    setPendingAction(`unlink:${episodeId}`);
    try {
      await onUnlink(episodeId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("unlinkFailed"));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="source-episode-links-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t("episodeLinksEyebrow")}</p>
          <h2 id="source-episode-links-title">{t("episodeLinks")}</h2>
          <p className={styles.muted}>{t("episodeLinksHint")}</p>
        </div>
        <Link2 size={18} className={styles.icon} aria-hidden="true" />
      </header>

      {actionError && <p className={styles.error} role="alert">{actionError}</p>}

      <div className={styles.columns}>
        <div className={styles.column}>
          <div className={styles.sectionHeading}>
            <h3>{t("linkedEpisodes")}</h3>
            <span className={styles.count}>{linkedEpisodes.length}</span>
          </div>
          {linkedEpisodes.length === 0 ? (
            <EmptyState className={styles.empty} title={t("noLinkedEpisodes")} description={t("noLinkedEpisodesHint")} />
          ) : (
            <ul className={styles.list} aria-label={t("linkedEpisodes")}>
              {linkedEpisodes.map(episode => (
                <li className={styles.row} key={episode.id}>
                  <div className={styles.copy}>
                    <strong>{episode.title}</strong>
                    <span>{episode.episode_number == null ? t("episodeNumberUnknown") : t("episodeNumber", { number: episode.episode_number })}</span>
                  </div>
                  <Button
                    variant="quiet"
                    aria-label={t("unlinkEpisode")}
                    isDisabled={relationBusy}
                    isPending={pendingAction === `unlink:${episode.id}`}
                    onPress={() => void unlinkEpisode(episode.id)}
                  >
                    <Unlink size={15} aria-hidden="true" />
                    {t("unlinkEpisode")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.column}>
          <div className={styles.sectionHeading}>
            <h3>{t("availableEpisodes")}</h3>
            <span className={styles.count}>{availableEpisodes.length}</span>
          </div>
          {availableEpisodes.length === 0 ? (
            <EmptyState className={styles.empty} title={t("noAvailableEpisodes")} description={t("noAvailableEpisodesHint")} />
          ) : (
            <div className={styles.linkForm}>
              <SelectField
                label={t("episodeToLink")}
                value={selectedEpisodeId || null}
                onChange={value => setSelectedEpisodeId(String(value || ""))}
                options={options}
                isDisabled={relationBusy}
              />
              <Button
                onPress={() => void linkSelected()}
                isDisabled={!selectedEpisodeId || relationBusy}
                isPending={pendingAction?.startsWith("link:")}
              >
                <Link2 size={15} aria-hidden="true" />
                {t("linkEpisode")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
