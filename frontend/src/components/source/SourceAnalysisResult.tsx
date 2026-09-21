"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@omnistudio/ui";
import { sourceApi, type SourceChapterAnalysis } from "@/lib/api";
import styles from "./SourceWorkspace.module.css";

interface Props {
  sourceId: string;
  chapterId: string;
  chapterTitle: string;
  analysisId?: string;
  currentRevisionId?: string | null;
}

const eventTypes = new Set(["action", "dialogue", "conflict", "revelation", "setting", "emotion", "transition", "hook"]);

export default function SourceAnalysisResult({ sourceId, chapterId, chapterTitle, analysisId, currentRevisionId }: Props) {
  const t = useTranslations("sourceWorkspace");
  const regionId = useId();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SourceChapterAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setLoading(true);
    setResult(null);
    setError(null);
    void (async () => {
      try {
        let analysis = await sourceApi.getChapterAnalysis(sourceId, chapterId);
        // A batch can reference an older successful attempt. Never silently
        // substitute a newer attempt's events for the batch result.
        if (analysisId && analysis.id !== analysisId) {
          const history = await sourceApi.listChapterAnalysisHistory(sourceId, chapterId);
          const saved = history.items.find(item => item.id === analysisId);
          if (!saved) throw new Error("Saved analysis not found");
          analysis = saved;
        }
        if (!disposed) setResult(analysis);
      } catch (cause) {
        if (disposed) return;
        const status = (cause as { response?: { status?: number } })?.response?.status;
        setError(t(status === 404 ? "analysisResultMissing" : "analysisResultLoadFailed"));
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => { disposed = true; };
  }, [open, sourceId, chapterId, analysisId, reload, t]);

  return <div className={styles.analysisResult}>
    <Button variant="quiet" onPress={() => setOpen(value => !value)} aria-expanded={open} aria-controls={regionId}
      aria-label={`${t(open ? "hideAnalysisResult" : "viewAnalysisResult")} ${chapterTitle}`}>
      {t(open ? "hideAnalysisResult" : "viewAnalysisResult")}
    </Button>
    {open && <div id={regionId} role="region" aria-label={t("analysisResultTitle", { title: chapterTitle })}>
      {loading && <p className={styles.muted} role="status">{t("analysisResultLoading")}</p>}
      {error && <div className={styles.analysisItemError} role="alert"><p>{error}</p>
        <Button variant="quiet" onPress={() => setReload(value => value + 1)}>{t("reloadAnalysisResult")}</Button>
      </div>}
      {result && <>
        <p className={styles.muted}>{t("analysisResultSummary", { revision: result.revision_number, count: result.events.length })}</p>
        {currentRevisionId && currentRevisionId !== result.revision_id && <p className={styles.analysisItemSkip}>{t("analysisResultOutdated")}</p>}
        {result.status === "processing" ? <p className={styles.muted}>{t("analysisResultProcessing")}</p>
          : result.status === "failed" ? <p className={styles.analysisItemError} role="alert">{result.error_message || t("analysisFailedShort")}</p>
          : result.events.length === 0 ? <p className={styles.muted}>{t("analysisResultEmpty")}</p>
          : <ol className={styles.analysisEvents}>
            {result.events.map((event, index) => <li key={`${event.sequence}-${index}`}>
              <div className={styles.analysisEventMeta}>
                <span>{eventTypes.has(event.event_type) ? t(`analysisEventTypes.${event.event_type}`) : event.event_type}</span>
                <span>{t("analysisImportance")}：<strong>{t(`analysisImportanceLevels.${event.importance}`)}</strong></span>
              </div>
              <p className={styles.analysisEventDescription}>{event.description}</p>
              <dl className={styles.analysisEventFacts}>
                <div><dt>{t("analysisCharacters")}</dt><dd>{event.characters.length ? event.characters.join(t("analysisCharacterSeparator")) : t("analysisNotSpecified")}</dd></div>
                <div><dt>{t("analysisLocation")}</dt><dd>{event.location || t("analysisNotSpecified")}</dd></div>
              </dl>
              {event.source_excerpt && <blockquote className={styles.analysisExcerpt}><span>{t("analysisSourceExcerpt")}</span><p>{event.source_excerpt}</p></blockquote>}
            </li>)}
          </ol>}
      </>}
    </div>}
  </div>;
}
