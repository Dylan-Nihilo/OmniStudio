'use client';

import { Copy, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, TextAreaField } from '@omnistudio/ui';
import { usePlaygroundStore } from './usePlaygroundStore';
import PromptTemplateModal from './PromptTemplateModal';
import PromptHistoryDrawer from './PromptHistoryDrawer';

const MAX_LENGTH = 2000;

export default function PromptInput() {
  const prompt = usePlaygroundStore((s) => s.prompt);
  const negativePrompt = usePlaygroundStore((s) => s.negativePrompt);
  const setPrompt = usePlaygroundStore((s) => s.setPrompt);
  const setNegativePrompt = usePlaygroundStore((s) => s.setNegativePrompt);
  const setShowTemplateModal = usePlaygroundStore((s) => s.setShowTemplateModal);
  const setShowHistoryDrawer = usePlaygroundStore((s) => s.setShowHistoryDrawer);
  const t = useTranslations('playground');

  return <div>
    <TextAreaField label={t('compose.promptLabel')} value={prompt} onChange={value => setPrompt(value.slice(0, MAX_LENGTH))}
      placeholder={t('prompt.placeholder')} maxLength={MAX_LENGTH} rows={5} />
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button variant="quiet" onPress={() => setShowTemplateModal(true)}><Copy size={14} />{t('prompt.templates')}</Button>
      <Button variant="quiet" onPress={() => setShowHistoryDrawer(true)}><Clock size={14} />{t('prompt.history')}</Button>
      <span className="ml-auto text-xs text-text-muted">{prompt.length} / {MAX_LENGTH}</span>
    </div>
    <details className="mt-3 text-xs text-text-muted">
      <summary className="cursor-pointer py-2">{t('prompt.negativeLabel')}</summary>
      <TextAreaField label={t('prompt.negativeLabel')} value={negativePrompt} onChange={setNegativePrompt} placeholder={t('prompt.negativePlaceholder')} rows={2} />
    </details>
    <PromptTemplateModal />
    <PromptHistoryDrawer />
  </div>;
}
