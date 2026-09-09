"use client";

import { Check, ChevronLeft, ChevronRight, FileText, History, Link2, RotateCcw, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, SelectField, TextAreaField, TextField } from "@omnistudio/ui";
import type { SourceChapter, SourceEpisode, SourceRevision, SourceRevisionImpact } from "@/lib/api";
import styles from "./SourceWorkspace.module.css";
import * as React from "react";

interface Props {
  chapters: SourceChapter[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  selectedChapter: SourceChapter | null;
  revisions: SourceRevision[];
  impacts: SourceRevisionImpact[];
  saving?: boolean;
  onQueryChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onSelect: (chapter: SourceChapter) => void;
  onSave: (payload: { title: string; content: string }) => void;
  onRestore: (revision: SourceRevision) => void;
  onClose: () => void;
  onAcknowledgeImpact?: (impactId: string) => void;
  onOpenScript?: (episodeId: string) => void;
  onLinkEpisode?: (chapterId: string) => void;
  episodes?: readonly SourceEpisode[];
  onLinkChapterEpisode?: (chapterId: string, episodeId: string) => void | Promise<void>;
  onUnlinkChapterEpisode?: (chapterId: string, episodeId: string) => void | Promise<void>;
}

export default function SourceChapterPanel({ chapters, total, page, pageSize, query, selectedChapter, revisions, impacts, saving = false, onQueryChange, onPageChange, onSelect, onSave, onRestore, onClose, onOpenScript, onAcknowledgeImpact, onLinkEpisode, episodes = [], onLinkChapterEpisode, onUnlinkChapterEpisode }: Props) {
  const t = useTranslations("sourceWorkspace");
  const tc = useTranslations("common");
  const ts = useTranslations("script");
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const [title, setTitle] = React.useState(selectedChapter?.title || "");
  const [content, setContent] = React.useState(selectedChapter?.current_revision?.content || "");
  const [showHistory, setShowHistory] = React.useState(false);
  const [episodeToLink, setEpisodeToLink] = React.useState("");
  const linkedIds = selectedChapter?.linked_episode_ids ?? [];
  const linkedEpisodes = episodes.filter(episode => linkedIds.includes(episode.id));
  const availableEpisodes = episodes.filter(episode => !linkedIds.includes(episode.id));
  const episodeOptions = availableEpisodes.map(episode => ({ id: episode.id, label: episode.episode_number == null ? episode.title : `EP.${String(episode.episode_number).padStart(2, "0")} · ${episode.title}` }));

  React.useEffect(() => {
    setTitle(selectedChapter?.title || "");
    setContent(selectedChapter?.current_revision?.content || "");
  }, [selectedChapter]);

  React.useEffect(() => {
    if (!availableEpisodes.some(episode => episode.id === episodeToLink)) setEpisodeToLink(availableEpisodes[0]?.id || "");
  }, [episodes, selectedChapter, episodeToLink]);

  if (selectedChapter) {
    return (
      <section className={styles.chapterDetail} aria-labelledby="source-chapter-title">
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>{t("chapterDetailEyebrow")}</p>
            <h2 id="source-chapter-title">{t("chapterDetailTitle", { title: selectedChapter.title })}</h2>
            <p className={styles.muted}>{t("revisionCount", { count: selectedChapter.revision_count })}</p>
            {linkedIds.length > 0 && <p className={styles.muted}>{t("chapterLinkedEpisodes", { count: linkedIds.length })}</p>}
          </div>
          <div className={styles.actionRow}><Button variant="quiet" onPress={() => setShowHistory(value => !value)}><History size={15} />{t("revisionHistory")}</Button><Button variant="quiet" onPress={onClose}><ChevronLeft size={16} />{t("backToChapters")}</Button></div>
        </div>
        <div className={styles.editorGrid}>
          <div className={styles.editorColumn}>
            <TextField label={t("chapterTitle")} value={title} onChange={setTitle} isDisabled={saving} />
            <TextAreaField label={t("chapterContent")} value={content} onChange={setContent} rows={14} isDisabled={saving} />
            <Button onPress={() => onSave({ title: title.trim(), content })} isPending={saving} isDisabled={!title.trim() || !content.trim()}><Save size={16} />{t("saveRevision")}</Button>
          </div>
          <aside className={styles.historyColumn} aria-label={t("revisionHistory")}>
            <div className={styles.subsectionHeader}><h3>{t("revisionHistory")}</h3><History size={16} /></div>
            {showHistory && (revisions.length === 0 ? <p className={styles.muted}>{t("noRevisions")}</p> : revisions.map(revision => (
              <article key={revision.id} className={styles.revisionRow}>
                <div><strong>{t("revisionLabel", { number: revision.revision_number })}</strong><span>{new Date(revision.created_at * 1000).toLocaleString()}</span></div>
                <p>{revision.content.slice(0, 120)}</p>
                {revision.id !== selectedChapter.current_revision_id && <Button variant="quiet" onPress={() => onRestore(revision)} isDisabled={saving}><RotateCcw size={14} />{t("restoreRevision", { number: revision.revision_number })}</Button>}
              </article>
            )))}
            <div className={styles.impactBlock}>
              <h3>{t("impactEvents")}</h3>
              {impacts.length === 0 ? <p className={styles.muted}>{t("noImpactEvents")}</p> : impacts.map(impact => (
                <article key={impact.id} className={styles.impactEvent}>
                  <p>{t("impactSummary", { revision: impact.revision_number, count: impact.target_count })}</p>
                  {onAcknowledgeImpact && impact.status === "open" && <Button variant="quiet" onPress={() => onAcknowledgeImpact(impact.id)} isDisabled={saving}><Check size={14} />确认已处理</Button>}
                  {impact.targets.length > 0 && (
                    <ul className={styles.impactTargets} aria-label={t("impactTargets")}>
                      {impact.targets.map(target => (
                        <li key={target.id}>
                          <strong>{target.target_type}</strong>
                          <span>{t("impactTarget", { stage: target.target_stage, status: target.status, id: target.target_id })}</span>
                          {onOpenScript && target.episode_id && <Button
                            variant="quiet"
                            aria-label={`${tc("open")} ${ts("scriptEditor")}`}
                            isDisabled={saving}
                            onPress={() => onOpenScript(target.episode_id!)}
                          >
                            <FileText size={14} aria-hidden="true" />
                            {tc("open")}
                          </Button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </aside>
        </div>
        {onLinkChapterEpisode && <div className={styles.impactBlock} aria-label={t("chapterEpisodeRelations")}>
          <div className={styles.subsectionHeader}><h3>{t("chapterEpisodeRelations")}</h3><Link2 size={16} /></div>
          {linkedEpisodes.length > 0 && <ul className={styles.impactTargets}>{linkedEpisodes.map(episode => <li key={episode.id}><strong>{episode.title}</strong><Button variant="quiet" aria-label={`${t("unlinkChapterEpisode")} ${episode.title}`} isDisabled={saving} onPress={() => void onUnlinkChapterEpisode?.(selectedChapter.id, episode.id)}><RotateCcw size={14} />{t("unlinkChapterEpisode")}</Button></li>)}</ul>}
          {episodeOptions.length > 0 ? <div className={styles.actionRow}><SelectField label={t("chapterEpisodeToLink")} value={episodeToLink || null} onChange={value => setEpisodeToLink(String(value || ""))} options={episodeOptions} isDisabled={saving} /><Button onPress={() => episodeToLink && void onLinkChapterEpisode(selectedChapter.id, episodeToLink)} isDisabled={!episodeToLink || saving}><Link2 size={14} />{t("linkChapterEpisode")}</Button></div> : <p className={styles.muted}>{t("noAvailableChapterEpisodes")}</p>}
        </div>}
      </section>
    );
  }

  return (
    <section className={styles.chapterPanel} aria-labelledby="source-chapters-title">
      <div className={styles.panelHeader}>
        <div><p className={styles.eyebrow}>{t("chaptersEyebrow")}</p><h2 id="source-chapters-title">{t("chapters")}</h2></div>
        <TextField label={t("searchChapters")} value={query} onChange={onQueryChange} placeholder={t("searchChaptersPlaceholder")} />
      </div>
      {chapters.length === 0 ? <p className={styles.emptyInline}>{t("noChapters")}</p> : <div className={styles.chapterList}>
        {chapters.map(chapter => <div key={chapter.id} className={styles.chapterRow}>
          <button type="button" aria-label={chapter.title} className={styles.chapterRow} onClick={() => onSelect(chapter)}>
            <span className={styles.chapterNumber}>{t("chapterShort", { number: chapter.chapter_number })}</span>
            <span className={styles.chapterRowTitle}>{chapter.title}</span>
            <span className={styles.revisionBadge}>{t("revisionCount", { count: chapter.revision_count })}</span>
            <ChevronRight size={16} />
          </button>
          {onLinkEpisode && <Button variant="quiet" aria-label={`link ${chapter.title}`} onPress={() => onLinkEpisode(chapter.id)}><Link2 size={14} /></Button>}
        </div>)}
      </div>}
      <div className={styles.pagination}>
        <span>{t("pageOf", { page, count: pageCount })}</span>
        <div><Button variant="quiet" onPress={() => onPageChange(page - 1)} isDisabled={page <= 1}><ChevronLeft size={15} />{t("previous")}</Button><Button variant="quiet" onPress={() => onPageChange(page + 1)} isDisabled={page >= pageCount}><ChevronRight size={15} />{t("next")}</Button></div>
      </div>
    </section>
  );
}
