"use client";

import { Brain, RefreshCw, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@omnistudio/ui";
import type { SourceAnalysisBatch, SourceAnalysisBatchItem, SourceChapter } from "@/lib/api";
import styles from "./SourceWorkspace.module.css";

interface Props {
  chapters: SourceChapter[];
  batch: SourceAnalysisBatch | null;
  busy?: boolean;
  onAnalyze: (chapterIds?: string[]) => void;
  onRetry: (chapterIds?: string[]) => void;
}

export default function SourceAnalysisPanel({ chapters, batch, busy = false, onAnalyze, onRetry }: Props) {
  const t = useTranslations("sourceWorkspace");
  const tStatus = useTranslations("taskCenter");
  const items = batch
    ? batch.items.length > 0
      ? batch.items
      : [...batch.success_items, ...batch.failed_items, ...batch.skipped_items]
    : [];
  const failedItems = items.filter(item => item.status === "failed");

  const renderItemDetail = (item: SourceAnalysisBatchItem) => {
    if (item.status === "failed" && (item.error_code || item.error_message)) {
      return (
        <div className={styles.analysisItemError} role="alert">
          {item.error_code && <code className={styles.analysisErrorCode}>{item.error_code}</code>}
          {item.error_message && <p>{item.error_message}</p>}
        </div>
      );
    }
    if (item.status === "skipped" && item.skip_reason) {
      return <p className={styles.analysisItemSkip}>{item.skip_reason}</p>;
    }
    return null;
  };

  return (
    <section className={styles.analysisPanel} aria-labelledby="source-analysis-title">
      <div className={styles.panelHeader}>
        <div><p className={styles.eyebrow}>{t("analysisEyebrow")}</p><h2 id="source-analysis-title">{t("chapterAnalysis")}</h2><p className={styles.muted}>{t("analysisHint")}</p></div>
        <Button onPress={() => onAnalyze()} isPending={busy} isDisabled={!chapters.length}><Sparkles size={16} />{t("analyzeAll")}</Button>
      </div>
      {batch ? <>
        <div className={styles.analysisStats} role="status"><span>{t("analysisStatus", { status: batch.status })}</span><span>{t("analysisCounts", { succeeded: batch.succeeded, failed: batch.failed, skipped: batch.skipped })}</span></div>
        {failedItems.length > 0 && <div className={styles.failureBox} role="alert"><Brain size={16} /><span>{t("analysisFailed", { count: failedItems.length })}</span><Button variant="quiet" onPress={() => onRetry()} isPending={busy}><RefreshCw size={15} />{t("retryFailed")}</Button></div>}
        {items.length > 0 && <div className={styles.analysisDetails} aria-label={t("chapterAnalysis")}>
          {items.map(item => (
            <article key={item.id} className={`${styles.analysisItem} ${styles[`analysisItem-${item.status}`]}`} aria-label={`${tStatus(item.status)}: ${item.chapter_title}`}>
              <div className={styles.analysisItemHeader}>
                <div className={styles.analysisItemIdentity}>
                  <span className={styles.analysisChapterNumber}>{t("chapterShort", { number: item.chapter_number })}</span>
                  <strong>{item.chapter_title}</strong>
                </div>
                <span className={styles.analysisItemStatus} data-status={item.status}>{tStatus(item.status)}</span>
              </div>
              {renderItemDetail(item)}
              {item.status === "failed" && <Button className={styles.analysisItemRetry} variant="quiet" onPress={() => onRetry([item.chapter_id])} isPending={busy} aria-label={`${t("retryFailed")} ${item.chapter_title}`}><RefreshCw size={14} />{t("retryFailed")}</Button>}
            </article>
          ))}
        </div>}
      </> : <p className={styles.emptyInline}>{t("analysisEmpty")}</p>}
    </section>
  );
}
