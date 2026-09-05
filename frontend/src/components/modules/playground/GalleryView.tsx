'use client';

import { useState } from 'react';
import { Button } from '@omnistudio/ui';
import { Film, Image as ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getAssetUrl } from '@/lib/utils';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';
import ResultCard from './ResultCard';
import styles from './PlaygroundPage.module.css';

interface GalleryViewProps {
  generations: PlaygroundGeneration[];
  onOpenDetail: (generation: PlaygroundGeneration, outputId?: string) => void;
  onRetry?: (generation: PlaygroundGeneration) => void;
  onDelete?: (generation: PlaygroundGeneration) => void;
  onGenerateVideo?: (path: string) => void;
}

export default function GalleryView({ generations, onOpenDetail, onRetry, onDelete, onGenerateVideo }: GalleryViewProps) {
  const t = useTranslations('playground');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const useAsReference = usePlaygroundStore(s => s.useResultAsReference);
  const current = generations.find(generation => generation.id === selectedId) ?? generations[0];
  if (!current) return <p className="p-6 text-sm text-text-muted">{t('results.emptyTitle')}</p>;
  const selected = current.outputs.find(output => output.id === selectedOutputId) ?? current.outputs[0];

  return <div className={styles.candidateView}>
    <header className={styles.taskHeading}>
      <h3>{current.prompt}</h3>
      <p>{current.model_id}{current.parameters.duration ? ` · ${current.parameters.duration}s` : ''}{current.parameters.aspect_ratio ? ` · ${current.parameters.aspect_ratio}` : ''}</p>
    </header>
    {current.status === 'completed' && current.outputs.length > 0 ? <div className={styles.candidates}>
      {current.outputs.map((output, index) => <article key={output.id} className={styles.candidate} data-selected={output.id === selected?.id}>
        <ResultCard generation={current} outputIndex={index} aspectRatio="1" onGenerateVideo={onGenerateVideo} onOpenDetail={() => setSelectedOutputId(output.id)} />
        <div className={styles.candidateActions}>
          <Button variant="quiet" aria-pressed={output.id === selected?.id} onPress={() => setSelectedOutputId(output.id)}>{t('gallery.candidate', { count: index + 1 })}</Button>
          <Button variant="quiet" onPress={() => onOpenDetail(current, output.id)}>{t('gallery.viewDetail')}</Button>
        </div>
      </article>)}
    </div> : <ResultCard generation={current} onRetry={onRetry} onDelete={onDelete} onOpenDetail={onOpenDetail} />}
    <section className={styles.taskHistory} aria-label={t('gallery.taskHistory')}>
      <h3>{t('gallery.taskHistory')}</h3>
      <div className={styles.taskStrip} onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next = Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
        buttons[next]?.focus();
        setSelectedId(generations[next].id);
        setSelectedOutputId(null);
      }}>
        {generations.map(generation => {
          const output = generation.outputs[0];
          const thumbnail = output?.thumbnail_path || (output?.media_type === 'image' ? output.media_path : null);
          return <button key={generation.id} type="button" aria-pressed={current.id === generation.id} aria-label={generation.prompt || generation.model_id} onClick={() => { setSelectedId(generation.id); setSelectedOutputId(null); }}>
            {thumbnail ? <img src={getAssetUrl(thumbnail.replace(/^output\//, ''))} alt="" /> : <span className={styles.taskPlaceholder}>{output?.media_type === 'video' ? <Film size={24} /> : <ImageIcon size={24} />}</span>}
            <span>{generation.prompt || generation.model_id}</span>
          </button>;
        })}
      </div>
    </section>
    {current.status === 'completed' && selected?.media_path && <footer className={styles.useCandidate}>
      <Button variant="secondary" onPress={() => useAsReference(selected.media_path, selected.media_type)}>{t('gallery.useCandidate')}</Button>
    </footer>}
  </div>;
}
