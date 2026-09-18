"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, RefreshCw, Search, ShieldCheck, Sparkles, Undo2, Redo2, X } from 'lucide-react';
import { Button, IconButton, SelectField, Tabs, TextAreaField, TextField } from '@omnistudio/ui';
import { api } from '@/lib/api';
import { applyWritingPreview, paragraphRange, writingError, type ContinuityReport, type TextRange, type WritingAction, type WritingPreview, type WritingScope } from '@/lib/scriptWriting';
import ScriptTextEditor, { type ScriptEditorHandle } from './ScriptTextEditor';
import styles from './ScriptWritingEditor.module.css';

interface Props {
  projectId: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  footer: ReactNode;
  outline: ReactNode;
  reference: ReactNode;
}

export default function ScriptWritingEditor({ projectId, value, readOnly, onChange, onSave, footer, outline, reference }: Props) {
  const t = useTranslations('scriptWriting');
  const ts = useTranslations('script');
  const page = useTranslations('scriptPage');
  const panelId = useId();
  const editor = useRef<ScriptEditorHandle>(null);
  const instructionInput = useRef<HTMLTextAreaElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const currentText = useRef(value);
  currentText.current = value;
  const baseline = useRef(value);
  const active = useRef(true);
  const editRequest = useRef<AbortController | null>(null);
  const checkRequest = useRef<AbortController | null>(null);
  const lastCheckAttempt = useRef<string | null>(null);
  const [selection, setSelection] = useState<TextRange>({ start: 0, end: 0 });
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [tab, setTab] = useState('writing');
  const [view, setView] = useState('script');
  const [scope, setScope] = useState<WritingScope>('document');
  const [action, setAction] = useState<WritingAction>('expand');
  const [instruction, setInstruction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [preview, setPreview] = useState<{ source: string; result: WritingPreview } | null>(null);
  const [report, setReport] = useState<{ source: string; result: ContinuityReport } | null>(null);
  const [editError, setEditError] = useState('');
  const [checkError, setCheckError] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [focusedIssue, setFocusedIssue] = useState<TextRange | null>(null);
  const busy = generating || checking;
  const selectedRange = scope === 'document' ? { start: 0, end: value.length }
    : scope === 'paragraph' ? paragraphRange(value, selection) : selection;
  const target = value.slice(selectedRange.start, selectedRange.end);
  const stalePreview = preview !== null && preview.source !== value;
  const staleReport = report !== null && report.source !== value;
  const tooLong = value.length > 60_000;

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; editRequest.current?.abort(); checkRequest.current?.abort(); };
  }, []);

  const matches = useMemo(() => {
    const result: TextRange[] = [];
    if (!query) return result;
    let at = value.indexOf(query);
    while (at >= 0) { result.push({ start: at, end: at + query.length }); at = value.indexOf(query, at + query.length); }
    return result;
  }, [value, query]);
  const highlights = useMemo(() => {
    // ponytail: cap decorations for long documents; virtualize highlighting if this ceiling matters.
    if (findOpen) return matches.slice(0, 500);
    if (focusedIssue && report?.source === value) return [focusedIssue];
    return [];
  }, [findOpen, matches, focusedIssue, report?.source, value]);

  function openWriting() {
    if (readOnly) return;
    setView('script'); setTab('writing');
    setScope(selection.end > selection.start ? 'selection' : value.trim() ? 'paragraph' : 'document');
    setAction(value.trim() ? 'polish' : 'expand');
    requestAnimationFrame(() => instructionInput.current?.focus());
  }
  function openFind() { setView('script'); setFindOpen(true); requestAnimationFrame(() => searchInput.current?.focus()); }
  function locate(range: TextRange) { setView('script'); editor.current?.focus(range); }
  function navigateMatch(direction: number) {
    if (!matches.length) return;
    const index = ((matchIndex + direction) % matches.length + matches.length) % matches.length;
    setMatchIndex(index); locate(matches[index]);
  }
  function replaceMatch(all: boolean) {
    if (readOnly || !query || !matches.length) return;
    if (all) editor.current?.replace(value.replaceAll(query, () => replaceWith));
    else {
      const match = matches[matchIndex % matches.length];
      editor.current?.replace(value.slice(0, match.start) + replaceWith + value.slice(match.end),
        { start: match.start, end: match.start + replaceWith.length });
    }
  }
  async function generate() {
    if (readOnly || editRequest.current || checkRequest.current || tooLong || (scope !== 'document' && !target.trim()) || (!value.trim() && !instruction.trim())) return;
    const controller = new AbortController(); editRequest.current = controller;
    const source = value;
    setGenerating(true); setEditError(''); setPreview(null);
    try {
      const result = await api.previewScriptWriting(projectId, { text: source, instruction, scope, action,
        ...(scope !== 'document' ? { selection: selectedRange } : {}) }, controller.signal);
      if (!active.current || editRequest.current !== controller) return;
      setPreview({ source, result });
    } catch (error) {
      if (active.current && !controller.signal.aborted) setEditError(writingError(error, t('generationFailed')));
    } finally {
      if (active.current && editRequest.current === controller) { editRequest.current = null; setGenerating(false); }
    }
  }
  function cancelWriting() { editRequest.current?.abort(); editRequest.current = null; setGenerating(false); }
  function accept() {
    if (!preview || readOnly) return;
    const next = applyWritingPreview(currentText.current, preview.source, preview.result);
    if (next === null) { setEditError(t('stalePreview')); return; }
    const start = preview.result.scope === 'document' ? 0 : preview.result.selection!.start;
    setView('script');
    editor.current?.replace(next, { start, end: start + preview.result.replacement.length });
    setPreview(null); setEditError('');
  }
  async function inspect() {
    if (readOnly || editRequest.current || checkRequest.current || !currentText.current.trim() || currentText.current.length > 60_000) return;
    const source = currentText.current;
    const controller = new AbortController(); checkRequest.current = controller;
    lastCheckAttempt.current = source;
    setChecking(true); setCheckError('');
    try {
      const result = await api.checkScriptContinuity(projectId, source, baseline.current, controller.signal);
      if (!active.current || checkRequest.current !== controller) return;
      setReport({ source, result }); baseline.current = source; setFocusedIssue(null);
    } catch (error) {
      if (active.current && !controller.signal.aborted) setCheckError(writingError(error, t('checkFailed')));
    } finally {
      if (active.current && checkRequest.current === controller) { checkRequest.current = null; setChecking(false); }
    }
  }
  useEffect(() => {
    if (!automatic || readOnly || busy || !value.trim() || tooLong || value === lastCheckAttempt.current) return;
    const timer = setTimeout(() => void inspect(), 4000);
    return () => clearTimeout(timer);
  }, [automatic, readOnly, busy, value, tooLong]);

  function locateQuote(quote: string) {
    const index = value.indexOf(quote);
    if (index < 0 || staleReport) return;
    const range = { start: index, end: index + quote.length };
    setFocusedIssue(range); locate(range);
  }
  function reviseIssue(quote: string, message: string, suggestion: string) {
    const index = value.indexOf(quote);
    if (index < 0 || staleReport) return;
    const range = { start: index, end: index + quote.length };
    setSelection(range); setScope('selection'); setAction('rewrite');
    setInstruction(`${message}\n${suggestion}`); setTab('writing'); setPreview(null); locate(range);
    requestAnimationFrame(() => instructionInput.current?.focus());
  }

  const writing = <section className={styles.writingPanel}>
    <div className={styles.panelHeading}><Sparkles size={18} /><h3>{t('writingTitle')}</h3></div>
    <p className={styles.hint}>{t('writingHint')}</p>
    <SelectField label={t('scope')} value={scope} onChange={key => { setScope(String(key) as WritingScope); setPreview(null); }} isDisabled={generating}
      options={(['selection', 'paragraph', 'document'] as const).map(id => ({ id, label: t(`scopes.${id}`) }))} />
    {scope !== 'document' && <div className={styles.target}><span>{t('target', { count: target.length })}</span><p>{target || t('selectTarget')}</p></div>}
    <div className={styles.actionsGrid} role="group" aria-label={t('action')}>
      {(['polish', 'rewrite', 'expand', 'shorten', 'reorder', 'continue'] as const).map(id => <button key={id} type="button" aria-pressed={action === id}
        disabled={generating || readOnly} onClick={() => { setAction(id); setPreview(null); }}>{t(`actions.${id}`)}</button>)}
    </div>
    <TextAreaField inputRef={instructionInput} label={t('instruction')} placeholder={t('instructionPlaceholder')} value={instruction} onChange={setInstruction}
      rows={4} maxLength={2000} isDisabled={readOnly || generating} />
    <p className={styles.usage}>{t('usage')}</p>
    {tooLong && <p role="alert" className={styles.error}>{t('tooLong')}</p>}
    <div className={styles.panelButtons}>
      <Button onPress={() => void generate()} isPending={generating} isDisabled={readOnly || busy || tooLong || (scope !== 'document' && !target.trim()) || (!value.trim() && !instruction.trim())}>
        <Sparkles size={16} />{generating ? t('generating') : t('generate')}
      </Button>
      {generating && <Button variant="quiet" onPress={cancelWriting}>{t('cancelWaiting')}</Button>}
    </div>
    {editError && <p role="alert" className={styles.error}>{editError}</p>}
    {preview && <section className={styles.preview} aria-label={t('preview')}>
      <div className={styles.panelHeading}><h3>{t('preview')}</h3><IconButton aria-label={t('dismiss')} onPress={() => setPreview(null)}><X size={16} /></IconButton></div>
      {preview.result.summary && <p className={styles.summary}>{preview.result.summary}</p>}
      <details><summary>{t('original')}</summary><pre className={styles.before}>{preview.result.original || t('emptyScript')}</pre></details>
      <TextAreaField label={t('replacement')} value={preview.result.replacement} onChange={replacement => setPreview({ ...preview, result: { ...preview.result, replacement } })} rows={8} isDisabled={readOnly} />
      {stalePreview && <p role="alert" className={styles.warning}>{t('stalePreview')}</p>}
      <div className={styles.panelButtons}>
        <Button onPress={accept} isDisabled={readOnly || stalePreview || !preview.result.replacement.trim()}><Check size={16} />{t('accept')}</Button>
        <Button variant="quiet" onPress={() => void generate()} isDisabled={readOnly || busy}><RefreshCw size={15} />{t('regenerate')}</Button>
      </div>
      <p className={styles.hint}>{t('undoHint')}</p>
    </section>}
  </section>;

  const continuity = <section className={styles.writingPanel}>
    <div className={styles.panelHeading}><ShieldCheck size={18} /><h3>{t('continuityTitle')}</h3></div>
    <p className={styles.hint}>{t('continuityHint')}</p>
    <label className={styles.autoCheck}><input type="checkbox" checked={automatic} disabled={readOnly} onChange={event => { setAutomatic(event.target.checked); lastCheckAttempt.current = null; }} />{t('automatic')}</label>
    <p className={styles.usage}>{t('automaticHint')}</p>
    <Button variant="secondary" onPress={() => void inspect()} isPending={checking} isDisabled={readOnly || busy || !value.trim() || tooLong}>
      <ShieldCheck size={16} />{checking ? t('checking') : t('check')}
    </Button>
    {checkError && <p role="alert" className={styles.error}>{checkError}</p>}
    {staleReport && <p className={styles.warning}>{t('staleReport')}</p>}
    {!report && !checking && <p className={styles.empty}>{t('unchecked')}</p>}
    {report && !staleReport && !checking && !report.result.issues.length && <p className={styles.clean}>{t('noIssues')}</p>}
    {report && report.result.issues.map((issue, index) => <article key={`${issue.quote}-${index}`} className={styles.issue}>
      <div className={styles.issueHeading}><span>{t(`categories.${issue.category}`)}</span><span>{t(`severities.${issue.severity}`)}</span></div>
      <h4>{issue.message}</h4>
      <button type="button" className={styles.quote} disabled={staleReport} onClick={() => locateQuote(issue.quote)}>{issue.quote}</button>
      <span className={styles.versus}>{t('conflictsWith')}</span>
      <button type="button" className={styles.quote} disabled={staleReport} onClick={() => locateQuote(issue.related_quote)}>{issue.related_quote}</button>
      <p>{issue.suggestion}</p>
      <Button variant="quiet" isDisabled={readOnly || staleReport || busy} onPress={() => reviseIssue(issue.quote, issue.message, issue.suggestion)}>{t('reviseIssue')}</Button>
    </article>)}
  </section>;

  const content = <div className={styles.editorPane}>
    <div className={styles.toolbar}>
      <div className={styles.tools}>
        <IconButton aria-label={t('undo')} isDisabled={readOnly || !history.undo} onPress={() => editor.current?.undo()}><Undo2 size={17} /></IconButton>
        <IconButton aria-label={t('redo')} isDisabled={readOnly || !history.redo} onPress={() => editor.current?.redo()}><Redo2 size={17} /></IconButton>
        <span className={styles.separator} />
        <IconButton aria-label={t('moveUp')} isDisabled={readOnly} onPress={() => editor.current?.move(-1)}><ArrowUp size={17} /></IconButton>
        <IconButton aria-label={t('moveDown')} isDisabled={readOnly} onPress={() => editor.current?.move(1)}><ArrowDown size={17} /></IconButton>
        <IconButton aria-label={t('find')} onPress={openFind}><Search size={17} /></IconButton>
      </div>
      <Button variant="secondary" onPress={openWriting} isDisabled={readOnly}><Sparkles size={15} />{selection.end > selection.start ? t('editSelection') : t('aiEdit')}<kbd>⌘ K</kbd></Button>
    </div>
    {findOpen && <div className={styles.findBar} aria-label={t('find')}>
      <TextField inputRef={searchInput} label={t('findText')} value={query} onChange={text => { setQuery(text); setMatchIndex(0); }} />
      <TextField label={t('replaceText')} value={replaceWith} onChange={setReplaceWith} isDisabled={readOnly} />
      <div className={styles.findActions}>
        <span>{t('matches', { count: matches.length })}</span>
        <IconButton aria-label={t('previousMatch')} isDisabled={!matches.length} onPress={() => navigateMatch(-1)}><ChevronLeft size={16} /></IconButton>
        <IconButton aria-label={t('nextMatch')} isDisabled={!matches.length} onPress={() => navigateMatch(1)}><ChevronRight size={16} /></IconButton>
        <Button variant="quiet" isDisabled={readOnly || !matches.length} onPress={() => replaceMatch(false)}>{t('replace')}</Button>
        <Button variant="quiet" isDisabled={readOnly || !matches.length} onPress={() => replaceMatch(true)}>{t('replaceAll')}</Button>
        <IconButton aria-label={t('closeFind')} onPress={() => { setFindOpen(false); editor.current?.focus(); }}><X size={16} /></IconButton>
      </div>
    </div>}
    <div className={styles.documentScroll}>
      <ScriptTextEditor ref={editor} value={value} readOnly={readOnly} label={ts('scriptEditor')} placeholder={t('placeholder')}
        highlights={highlights} onChange={onChange} onSelection={setSelection} onSave={onSave} onAI={openWriting} onFind={openFind}
        onHistory={next => setHistory(old => old.undo === next.undo && old.redo === next.redo ? old : next)} />
    </div>
    <div className={styles.editorHint}>{selection.end > selection.start ? t('selectedCount', { count: selection.end - selection.start }) : t('keyboardHint')}</div>
  </div>;

  return <div className={styles.layout}>
    <section className={styles.paper}>
      <div role="tablist" aria-label={page('editorView')} className={styles.viewTabs}>
        {(['outline', 'script'] as const).map(id => <button key={id} id={`${panelId}-${id}-tab`} type="button" role="tab"
          aria-selected={view === id} aria-controls={`${panelId}-${id}`} tabIndex={view === id ? 0 : -1}
          onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const next = id === 'script' ? 'outline' : 'script'; setView(next); document.getElementById(`${panelId}-${next}-tab`)?.focus(); } }}
          onClick={() => setView(id)}>{page(id)}</button>)}
      </div>
      <div className={styles.viewPanel} id={`${panelId}-outline`} role="tabpanel" aria-labelledby={`${panelId}-outline-tab`} hidden={view !== 'outline'}>{outline}</div>
      <div className={styles.viewPanel} id={`${panelId}-script`} role="tabpanel" aria-labelledby={`${panelId}-script-tab`} hidden={view !== 'script'}>{content}</div>
      {footer}
    </section>
    <aside className={styles.rail}>
      <Tabs aria-label={t('assistantTabs')} selectedKey={tab} onSelectionChange={key => setTab(String(key))} items={[
        { id: 'writing', label: t('writingTab'), content: writing },
        { id: 'continuity', label: report && !staleReport && report.result.issues.length ? `${t('continuityTab')} · ${report.result.issues.length}` : t('continuityTab'), content: continuity },
        { id: 'reference', label: page('structure'), content: reference },
      ]} />
    </aside>
  </div>;
}
