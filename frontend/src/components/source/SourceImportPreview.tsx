"use client";

import { Check, RotateCcw, Save, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, TextField } from "@omnistudio/ui";
import type { SourceImportChapterProposal, SourceImportPreview as SourceImportPreviewData } from "@/lib/api";
import styles from "./SourceWorkspace.module.css";

interface Props {
  preview: SourceImportPreviewData;
  busy?: boolean;
  onChange: (proposals: SourceImportChapterProposal[]) => void;
  onSaveBoundaries: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function SourceImportPreview({ preview, busy = false, onChange, onSaveBoundaries, onCancel, onConfirm }: Props) {
  const t = useTranslations("sourceWorkspace");
  const update = (index: number, patch: Partial<SourceImportChapterProposal>) => {
    onChange(preview.proposals.map((proposal, current) => current === index ? { ...proposal, ...patch } : proposal));
  };

  return (
    <section className={styles.previewPanel} aria-labelledby="source-import-preview-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>{t("previewEyebrow")}</p>
          <h2 id="source-import-preview-title">{t("importPreview")}</h2>
          <p className={styles.muted}>{t("previewSummary", { count: preview.proposals.length, filename: preview.original_filename || preview.title })}</p>
        </div>
        <span className={styles.statusPill}>{t("unconfirmed")}</span>
      </div>
      <div className={styles.chapterGrid}>
        {preview.proposals.map((proposal, index) => (
          <article key={`${proposal.chapter_number}-${index}`} className={styles.chapterProposal} aria-label={t("chapterAria", { number: proposal.chapter_number })}>
            <div className={styles.chapterMeta}>
              <span className={styles.chapterNumber}>{t("chapterShort", { number: proposal.chapter_number })}</span>
              <span className={styles.lineRange}>{t("lineRange", { start: proposal.start_line, end: proposal.end_line })}</span>
            </div>
            <TextField
              label={t("chapterTitle")}
              value={proposal.title}
              onChange={value => update(index, { title: value })}
              isDisabled={busy}
            />
            <div className={styles.boundaryFields}>
              <TextField
                label={t("startLine")}
                type="number"
                value={String(proposal.start_line)}
                onChange={value => update(index, { start_line: Number.parseInt(value, 10) || 0 })}
                isDisabled={busy}
              />
              <TextField
                label={t("endLine")}
                type="number"
                value={String(proposal.end_line)}
                onChange={value => update(index, { end_line: Number.parseInt(value, 10) || 0 })}
                isDisabled={busy}
              />
            </div>
            <div className={styles.contentPreview}>
              <span>{t("detectedContent")}</span>
              <p>{proposal.content}</p>
            </div>
          </article>
        ))}
      </div>
      <div className={styles.actionRow}>
        <Button variant="quiet" onPress={onCancel} isDisabled={busy}><X size={16} />{t("cancelPreview")}</Button>
        <Button variant="secondary" onPress={onSaveBoundaries} isDisabled={busy}><Save size={16} />{t("saveBoundaries")}</Button>
        <Button onPress={onConfirm} isDisabled={busy}><Check size={16} />{t("confirmImport")}</Button>
      </div>
      <p className={styles.helper}>{t("previewSafety")}</p>
    </section>
  );
}

export function PreviewResetButton({ onPress }: { onPress: () => void }) {
  const t = useTranslations("sourceWorkspace");
  return <Button variant="quiet" onPress={onPress}><RotateCcw size={15} />{t("resetPreview")}</Button>;
}
