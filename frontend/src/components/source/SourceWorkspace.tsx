"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, FileText, Link2, Plus, RefreshCw, Search, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, LoadingState, TextAreaField, TextField } from "@omnistudio/ui";
import {
  sourceApi,
  type SourceAnalysisBatch,
  type SourceChapter,
  type SourceDocument,
  type SourceEpisode,
  type SourceEpisodeSplitCreatedEpisode,
  type SourceEpisodeSplitPreview,
  type SourceEpisodeSplitProposal,
  type SourceImportBoundaryProposal,
  type SourceImportPreview as SourceImportPreviewData,
  type SourceRevision,
  type SourceRevisionImpact,
} from "@/lib/api";
import SourceImportPreview from "./SourceImportPreview";
import SourceChapterPanel from "./SourceChapterPanel";
import SourceAnalysisPanel from "./SourceAnalysisPanel";
import SourceEpisodeSplitPanel from "./SourceEpisodeSplitPanel";
import SourceEpisodePanel from "./SourceEpisodePanel";
import styles from "./SourceWorkspace.module.css";

function errorMessage(error: unknown, fallback: string): string {
  const value = error as { response?: { data?: { error?: { message?: string }; detail?: string } }; message?: string } | null;
  return value?.response?.data?.error?.message || value?.response?.data?.detail || value?.message || fallback;
}

function sourceTypeForFile(file: File): "txt" | "markdown" | "docx" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  return "txt";
}

export default function SourceWorkspace() {
  const t = useTranslations("sourceWorkspace");
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [selectedSource, setSelectedSource] = useState<SourceDocument | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<SourceChapter[]>([]);
  const [chapterTotal, setChapterTotal] = useState(0);
  const [chapterPage, setChapterPage] = useState(1);
  const [chapterQuery, setChapterQuery] = useState("");
  const [selectedChapter, setSelectedChapter] = useState<SourceChapter | null>(null);
  const [revisions, setRevisions] = useState<SourceRevision[]>([]);
  const [impacts, setImpacts] = useState<SourceRevisionImpact[]>([]);
  const [preview, setPreview] = useState<SourceImportPreviewData | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [importTitle, setImportTitle] = useState("");
  const [importContent, setImportContent] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [analysisBatch, setAnalysisBatch] = useState<SourceAnalysisBatch | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [splitPreview, setSplitPreview] = useState<SourceEpisodeSplitPreview | null>(null);
  const [splitCreatedEpisodes, setSplitCreatedEpisodes] = useState<SourceEpisodeSplitCreatedEpisode[]>([]);
  const [splitBusy, setSplitBusy] = useState(false);
  const [linkedEpisodes, setLinkedEpisodes] = useState<SourceEpisode[]>([]);
  const [availableEpisodes, setAvailableEpisodes] = useState<SourceEpisode[]>([]);
  const [episodeBusy, setEpisodeBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pageSize = 20;
  const selectedChapterTitle = selectedChapter?.title;
  const hasImportInput = Boolean(importFile || importContent.trim()) && Boolean(importTitle.trim());

  const loadSources = async (preferredId?: string | null) => {
    setLoading(true);
    try {
      const result = await sourceApi.list();
      setSources(result.items);
      const nextId = preferredId || selectedSourceId || result.items[0]?.id || null;
      setSelectedSourceId(nextId);
      if (!nextId) {
        setSelectedSource(null);
        setChapters([]);
        setLinkedEpisodes([]);
        setAvailableEpisodes([]);
      }
    } catch (cause) {
      setError(errorMessage(cause, t("loadFailed")));
    } finally {
      setLoading(false);
    }
  };

  const loadSourceDetail = async (sourceId: string) => {
    try {
      const detail = await sourceApi.get(sourceId);
      setSelectedSource(detail);
      setSelectedChapter(current => current && detail.chapters?.some(chapter => chapter.id === current.id) ? detail.chapters!.find(chapter => chapter.id === current.id) || null : null);
    } catch (cause) {
      setError(errorMessage(cause, t("loadFailed")));
    }
  };

  const loadChapters = async (sourceId: string, page = chapterPage, query = chapterQuery) => {
    try {
      const result = await sourceApi.listChapters(sourceId, { q: query.trim() || undefined, page, page_size: pageSize });
      setChapters(result.items);
      setChapterTotal(result.total);
    } catch (cause) {
      setError(errorMessage(cause, t("chaptersLoadFailed")));
    }
  };

  const loadEpisodeLinks = async (sourceId: string) => {
    try {
      const result = await sourceApi.listEpisodeCandidates(sourceId);
      setLinkedEpisodes(result.linked);
      setAvailableEpisodes(result.available);
    } catch (cause) {
      setError(errorMessage(cause, t("episodeLinksLoadFailed")));
    }
  };

  useEffect(() => { void loadSources(); }, []);

  useEffect(() => {
    if (!selectedSourceId) return;
    void loadSourceDetail(selectedSourceId);
    void loadChapters(selectedSourceId, chapterPage, chapterQuery);
    void loadEpisodeLinks(selectedSourceId);
  }, [selectedSourceId, chapterPage, chapterQuery]);

  const selectSource = (sourceId: string) => {
    setError(null);
    setNotice(null);
    setSelectedSourceId(sourceId);
    setSelectedChapter(null);
    setRevisions([]);
    setImpacts([]);
    setAnalysisBatch(null);
    setSplitPreview(null);
    setSplitCreatedEpisodes([]);
    setLinkedEpisodes([]);
    setAvailableEpisodes([]);
    setChapterPage(1);
  };

  const handlePreview = async () => {
    if (!hasImportInput || previewBusy) return;
    setPreviewBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (importFile) {
        const form = new FormData();
        form.append("title", importTitle.trim());
        form.append("source_type", sourceTypeForFile(importFile));
        form.append("file", importFile);
        setPreview(await sourceApi.previewImport(form));
      } else {
        setPreview(await sourceApi.previewImport({ title: importTitle.trim(), source_type: "paste", content: importContent }));
      }
    } catch (cause) {
      setError(errorMessage(cause, t("previewFailed")));
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleSaveBoundaries = async () => {
    if (!preview || previewBusy) return;
    setPreviewBusy(true);
    try {
      const result = await sourceApi.updateImportBoundaries(preview.id, preview.proposals);
      setPreview(result);
      setNotice(t("boundariesSaved"));
    } catch (cause) {
      setError(errorMessage(cause, t("saveFailed")));
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleCancelPreview = async () => {
    if (!preview || previewBusy) return;
    setPreviewBusy(true);
    try {
      await sourceApi.cancelImport(preview.id);
      setPreview(null);
      setNotice(t("previewCanceled"));
    } catch (cause) {
      setError(errorMessage(cause, t("cancelFailed")));
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!preview || previewBusy) return;
    setPreviewBusy(true);
    try {
      const result = await sourceApi.confirmImport(preview.id);
      setPreview(null);
      setImportFile(null);
      setImportContent("");
      setImportTitle("");
      setNotice(t("sourceImported"));
      await loadSources(result.source_document.id);
    } catch (cause) {
      setError(errorMessage(cause, t("confirmFailed")));
    } finally {
      setPreviewBusy(false);
    }
  };

  const selectChapter = async (chapter: SourceChapter) => {
    if (!selectedSourceId) return;
    setSelectedChapter(chapter);
    setError(null);
    try {
      const [history, impactList] = await Promise.all([
        sourceApi.listRevisions(selectedSourceId, chapter.id),
        sourceApi.listChapterRevisionImpacts(selectedSourceId, chapter.id),
      ]);
      setRevisions(history.items);
      setImpacts(impactList.items);
    } catch (cause) {
      setError(errorMessage(cause, t("historyLoadFailed")));
    }
  };

  const saveChapter = async ({ title, content }: { title: string; content: string }) => {
    if (!selectedSourceId || !selectedChapter || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await sourceApi.updateChapter(selectedSourceId, selectedChapter.id, { title, content });
      setSelectedChapter(updated);
      await Promise.all([loadChapters(selectedSourceId), loadSourceDetail(selectedSourceId), selectChapter(updated)]);
      setNotice(t("revisionSaved", { number: updated.current_revision?.revision_number || updated.revision_count }));
    } catch (cause) {
      setError(errorMessage(cause, t("saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const restoreRevision = async (revision: SourceRevision) => {
    if (!selectedSourceId || !selectedChapter || saving) return;
    setSaving(true);
    setError(null);
    try {
      const restored = await sourceApi.restoreRevision(selectedSourceId, selectedChapter.id, revision.id);
      setSelectedChapter(current => current ? { ...current, current_revision: restored, current_revision_id: restored.id, revision_count: Math.max(current.revision_count + 1, restored.revision_number) } : current);
      await Promise.all([loadChapters(selectedSourceId), loadSourceDetail(selectedSourceId)]);
      const [history, impactList] = await Promise.all([
        sourceApi.listRevisions(selectedSourceId, selectedChapter.id),
        sourceApi.listChapterRevisionImpacts(selectedSourceId, selectedChapter.id),
      ]);
      setRevisions(history.items);
      setImpacts(impactList.items);
      setNotice(t("revisionRestored", { number: restored.revision_number }));
    } catch (cause) {
      setError(errorMessage(cause, t("restoreFailed")));
    } finally {
      setSaving(false);
    }
  };

  const runAnalysis = async (chapterIds?: string[]) => {
    if (!selectedSourceId || analysisBusy) return;
    setAnalysisBusy(true);
    try {
      setAnalysisBatch(await sourceApi.analyzeSourceBatch(selectedSourceId, chapterIds ? { chapter_ids: chapterIds } : {}));
    } catch (cause) {
      setError(errorMessage(cause, t("analysisFailedShort")));
    } finally {
      setAnalysisBusy(false);
    }
  };

  const retryAnalysis = async (chapterIds?: string[]) => {
    if (!selectedSourceId || !analysisBatch || analysisBusy) return;
    setAnalysisBusy(true);
    try {
      const result = chapterIds?.length
        ? await sourceApi.retrySourceAnalysisBatch(selectedSourceId, analysisBatch.id, { chapter_ids: chapterIds })
        : await sourceApi.retrySourceAnalysisBatch(selectedSourceId, analysisBatch.id);
      setAnalysisBatch(result);
    } catch (cause) {
      setError(errorMessage(cause, t("analysisFailedShort")));
    } finally {
      setAnalysisBusy(false);
    }
  };

  const linkEpisode = async (episodeId: string) => {
    if (!selectedSourceId || episodeBusy) return;
    setEpisodeBusy(true);
    setError(null);
    try {
      await sourceApi.linkEpisode(selectedSourceId, episodeId);
      await Promise.all([loadEpisodeLinks(selectedSourceId), loadSourceDetail(selectedSourceId)]);
      setNotice(t("episodeLinked"));
    } catch (cause) {
      setError(errorMessage(cause, t("linkFailed")));
      throw cause;
    } finally {
      setEpisodeBusy(false);
    }
  };

  const unlinkEpisode = async (episodeId: string) => {
    if (!selectedSourceId || episodeBusy) return;
    setEpisodeBusy(true);
    setError(null);
    try {
      await sourceApi.unlinkEpisode(selectedSourceId, episodeId);
      await Promise.all([loadEpisodeLinks(selectedSourceId), loadSourceDetail(selectedSourceId)]);
      setNotice(t("episodeUnlinked"));
    } catch (cause) {
      setError(errorMessage(cause, t("unlinkFailed")));
      throw cause;
    } finally {
      setEpisodeBusy(false);
    }
  };

  const previewEpisodeSplit = async (suggestedEpisodes?: number) => {
    if (!selectedSourceId || splitBusy) return;
    setSplitBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sourceApi.previewEpisodeSplit(selectedSourceId, suggestedEpisodes ? { suggested_episodes: suggestedEpisodes } : {});
      setSplitPreview(result);
      setSplitCreatedEpisodes([]);
    } catch (cause) {
      setError(errorMessage(cause, t("splitFailed")));
    } finally {
      setSplitBusy(false);
    }
  };

  const saveEpisodeSplitPreview = async () => {
    if (!splitPreview || splitBusy) return;
    setSplitBusy(true);
    setError(null);
    try {
      const result = await sourceApi.updateEpisodeSplitPreview(splitPreview.id, { proposals: splitPreview.proposals });
      setSplitPreview(result);
      setNotice(t("splitSaved"));
    } catch (cause) {
      setError(errorMessage(cause, t("splitSaveFailed")));
    } finally {
      setSplitBusy(false);
    }
  };

  const cancelEpisodeSplitPreview = async () => {
    if (!splitPreview || splitBusy) return;
    setSplitBusy(true);
    setError(null);
    try {
      const result = await sourceApi.cancelEpisodeSplitPreview(splitPreview.id);
      setSplitPreview(result);
      setNotice(t("splitCanceled"));
    } catch (cause) {
      setError(errorMessage(cause, t("splitCancelFailed")));
    } finally {
      setSplitBusy(false);
    }
  };

  const confirmEpisodeSplit = async (payload: { title: string; description: string }) => {
    const sourceId = selectedSourceId;
    if (!splitPreview || splitBusy || !sourceId || !payload.title.trim()) return;
    setSplitBusy(true);
    setError(null);
    try {
      const result = await sourceApi.confirmEpisodeSplit(splitPreview.id, payload);
      setSplitPreview(current => current ? { ...current, status: "confirmed", series_id: result.series_id, episode_ids: result.episode_ids } : current);
      setSplitCreatedEpisodes(result.episodes);
      setNotice(t("splitConfirmed", { count: result.episodes.length }));
      await Promise.all([
        loadSources(sourceId),
        loadSourceDetail(sourceId),
        loadEpisodeLinks(sourceId),
      ]);
    } catch (cause) {
      setError(errorMessage(cause, t("splitConfirmFailed")));
    } finally {
      setSplitBusy(false);
    }
  };

  const selectedSummary = useMemo(() => selectedSource ? t("sourceSummary", { chapters: selectedSource.chapter_count, episodes: selectedSource.linked_episode_count }) : "", [selectedSource, t]);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><p className={styles.eyebrow}>{t("eyebrow")}</p><h1>{t("title")}</h1><p className={styles.subtitle}>{t("subtitle")}</p></div>
        <Button variant="secondary" onPress={() => void loadSources()} isPending={loading}><RefreshCw size={16} />{t("refresh")}</Button>
      </header>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice} role="status">{notice}</div>}

      <section className={styles.importPanel} aria-labelledby="source-import-title">
        <div className={styles.panelHeader}><div><p className={styles.eyebrow}>{t("importEyebrow")}</p><h2 id="source-import-title">{t("newImport")}</h2><p className={styles.muted}>{t("importHint")}</p></div><Upload size={20} className={styles.panelIcon} /></div>
        <div className={styles.formGrid}>
          <TextField label={t("sourceTitle")} value={importTitle} onChange={setImportTitle} placeholder={t("sourceTitlePlaceholder")} />
          <TextAreaField label={t("content")} value={importContent} onChange={value => { setImportContent(value); if (value) setImportFile(null); }} placeholder={t("contentPlaceholder")} rows={4} />
          <label className={styles.fileDrop}><FileText size={18} /><span>{importFile?.name || t("fileUpload")}</span><input type="file" accept=".txt,.md,.markdown,.docx" aria-label={t("fileUpload")} onChange={event => { const file = event.target.files?.[0] || null; setImportFile(file); if (file) setImportContent(""); }} /></label>
        </div>
        <div className={styles.actionRow}><Button onPress={() => void handlePreview()} isPending={previewBusy} isDisabled={!hasImportInput || Boolean(preview)}><Plus size={16} />{t("createPreview")}</Button>{!preview && <Button variant="secondary" onPress={() => undefined} isDisabled><Link2 size={16} />{t("confirmImport")}</Button>}</div>
      </section>

      {preview && <SourceImportPreview preview={preview} busy={previewBusy} onChange={proposals => setPreview(current => current ? { ...current, proposals } : current)} onSaveBoundaries={() => void handleSaveBoundaries()} onCancel={() => void handleCancelPreview()} onConfirm={() => void handleConfirmImport()} />}

      <div className={styles.workspaceGrid}>
        <aside className={styles.sourceListPanel} aria-labelledby="source-list-title">
          <div className={styles.panelHeader}><div><p className={styles.eyebrow}>{t("libraryEyebrow")}</p><h2 id="source-list-title">{t("sources")}</h2></div><BookOpen size={20} className={styles.panelIcon} /></div>
          {loading && sources.length === 0 ? <LoadingState label={t("loading")} /> : sources.length === 0 ? <EmptyState title={t("noSources")} description={t("noSourcesHint")} /> : <div className={styles.sourceList}>{sources.map(source => <button type="button" key={source.id} className={`${styles.sourceRow} ${selectedSourceId === source.id ? styles.sourceRowActive : ""}`} onClick={() => selectSource(source.id)}><span className={styles.sourceIcon}><FileText size={16} /></span><span className={styles.sourceRowCopy}><strong>{source.title}</strong><span>{source.original_filename || source.source_type}</span><small>{t("sourceSummary", { chapters: source.chapter_count, episodes: source.linked_episode_count })}</small></span></button>)}</div>}
        </aside>

        <main className={styles.detailPanel}>
          {!selectedSource ? <EmptyState title={t("selectSource")} description={t("selectSourceHint")} /> : <>
            <header className={styles.detailHeader}><div><p className={styles.eyebrow}>{t("detailEyebrow")}</p><h2>{selectedSource.title}</h2><p className={styles.muted}>{selectedSummary}</p></div><span className={styles.fileTag}>{selectedSource.original_filename || selectedSource.source_type}</span></header>
            <SourceChapterPanel chapters={chapters} total={chapterTotal} page={chapterPage} pageSize={pageSize} query={chapterQuery} selectedChapter={selectedChapter} revisions={revisions} impacts={impacts} saving={saving} onQueryChange={value => { setChapterQuery(value); setChapterPage(1); }} onPageChange={value => setChapterPage(Math.max(1, value))} onSelect={chapter => void selectChapter(chapter)} onSave={saveChapter} onRestore={restoreRevision} onClose={() => setSelectedChapter(null)} />
            {!selectedChapter && <>
              <SourceAnalysisPanel chapters={chapters} batch={analysisBatch} busy={analysisBusy} onAnalyze={runAnalysis} onRetry={retryAnalysis} />
              <SourceEpisodePanel linkedEpisodes={linkedEpisodes} availableEpisodes={availableEpisodes} busy={episodeBusy} onLink={linkEpisode} onUnlink={unlinkEpisode} />
              <SourceEpisodeSplitPanel preview={splitPreview} busy={splitBusy} createdEpisodes={splitCreatedEpisodes} onPreview={previewEpisodeSplit} onChange={(proposals: SourceEpisodeSplitProposal[]) => setSplitPreview(current => current ? { ...current, proposals } : current)} onSave={() => void saveEpisodeSplitPreview()} onCancel={() => void cancelEpisodeSplitPreview()} onConfirm={payload => void confirmEpisodeSplit(payload)} />
            </>}
          </>}
        </main>
      </div>
    </div>
  );
}
