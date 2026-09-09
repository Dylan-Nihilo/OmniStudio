"use client";

import { Check, RefreshCw, Save, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, TextAreaField, TextField } from "@omnistudio/ui";
import * as React from "react";
import type {
  SourceEpisodeSplitCreatedEpisode,
  SourceEpisodeSplitPreview,
  SourceEpisodeSplitProposal,
} from "@/lib/api";
import styles from "./SourceWorkspace.module.css";

interface Props {
  preview: SourceEpisodeSplitPreview | null;
  busy?: boolean;
  createdEpisodes: SourceEpisodeSplitCreatedEpisode[];
  onPreview: (suggestedEpisodes?: number) => void;
  onChange: (proposals: SourceEpisodeSplitProposal[]) => void;
  onSave: () => void;
  onCancel: () => void;
  onConfirm: (payload: { title: string; description: string }) => void;
}

export default function SourceEpisodeSplitPanel({
  preview,
  busy = false,
  createdEpisodes,
  onPreview,
  onChange,
  onSave,
  onCancel,
  onConfirm,
}: Props) {
  const t = useTranslations("sourceWorkspace");
  const [suggestedEpisodes, setSuggestedEpisodes] = React.useState("2");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");

  React.useEffect(() => {
    setTitle(preview?.title || "");
    setDescription("");
  }, [preview?.id]);

  const updateProposal = (index: number, patch: Partial<SourceEpisodeSplitProposal>) => {
    if (!preview) return;
    onChange(preview.proposals.map((proposal, current) => current === index ? { ...proposal, ...patch } : proposal));
  };

  const count = Number(suggestedEpisodes);
  const canPreview = Number.isFinite(count) && count >= 1 && count <= 50;
  const canConfirm = Boolean(preview?.proposals.length && title.trim());

  return (
    <section className={styles.splitPanel} aria-labelledby="source-episode-split-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>{t("splitEyebrow")}</p>
          <h2 id="source-episode-split-title">{t("episodeSplit")}</h2>
          <p className={styles.muted}>{t("splitHint")}</p>
        </div>
        <Sparkles size={20} className={styles.panelIcon} />
      </div>

      {!preview ? (
        <div className={styles.splitStart}>
          <TextField
            label={t("suggestedEpisodes")}
            type="number"
            value={suggestedEpisodes}
            onChange={setSuggestedEpisodes}
            isDisabled={busy}
          />
          <Button onPress={() => onPreview(count)} isPending={busy} isDisabled={!canPreview}>
            <Sparkles size={16} />{t("createSplitPreview")}
          </Button>
        </div>
      ) : (
        <>
          <div className={styles.splitStatus} role="status">
            <span>{t("splitPreviewStatus", { count: preview.proposals.length })}</span>
            <span className={styles.statusPill}>{t(preview.status === "confirmed" ? "confirmed" : "unconfirmed")}</span>
          </div>
          <div className={styles.splitProposalList}>
            {preview.proposals.map((proposal, index) => (
              <article key={`${proposal.episode_number}-${index}`} className={styles.splitProposal} aria-label={t("episodeProposalAria", { number: proposal.episode_number })}>
                <div className={styles.chapterMeta}>
                  <span className={styles.chapterNumber}>{t("episodeShort", { number: proposal.episode_number })}</span>
                  <span className={styles.lineRange}>{proposal.estimated_duration}</span>
                </div>
                <TextField
                  label={t("episodeTitle", { number: proposal.episode_number })}
                  value={proposal.title}
                  onChange={value => updateProposal(index, { title: value })}
                  isDisabled={busy || preview.status !== "previewing"}
                />
                <TextAreaField
                  label={t("episodeSummary", { number: proposal.episode_number })}
                  value={proposal.summary}
                  onChange={value => updateProposal(index, { summary: value })}
                  rows={3}
                  isDisabled={busy || preview.status !== "previewing"}
                />
                <div className={styles.markerRow}>
                  <span>{t("splitMarkers", { start: proposal.start_marker, end: proposal.end_marker })}</span>
                </div>
              </article>
            ))}
          </div>

          {preview.status === "previewing" && (
            <>
              <div className={styles.splitConfirmFields}>
                <TextField label={t("seriesTitle")} value={title} onChange={setTitle} isDisabled={busy} />
                <TextAreaField label={t("seriesDescription")} value={description} onChange={setDescription} rows={2} isDisabled={busy} />
              </div>
              <div className={styles.actionRow}>
                <Button variant="quiet" onPress={onCancel} isDisabled={busy}><X size={16} />{t("cancelSplitPreview")}</Button>
                <Button variant="secondary" onPress={onSave} isDisabled={busy}><Save size={16} />{t("saveSplitPreview")}</Button>
                <Button onPress={() => onConfirm({ title: title.trim(), description: description.trim() })} isDisabled={busy || !canConfirm}><Check size={16} />{t("confirmEpisodeSplit")}</Button>
              </div>
            </>
          )}
          {preview.status === "confirmed" && createdEpisodes.length > 0 && (
            <div className={styles.createdEpisodes} role="status">
              <strong>{t("createdEpisodes", { count: createdEpisodes.length })}</strong>
              <ul>{createdEpisodes.map(episode => <li key={episode.id}>{t("episodeShort", { number: episode.episode_number })} · {episode.title}</li>)}</ul>
            </div>
          )}
          {preview.status === "canceled" && <p className={styles.emptyInline}>{t("splitCanceled")}</p>}
          {preview.status === "previewing" && <p className={styles.helper}><RefreshCw size={13} />{t("splitSafety")}</p>}
        </>
      )}
    </section>
  );
}
