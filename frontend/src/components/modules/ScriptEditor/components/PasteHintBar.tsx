'use client';

import { Button, IconButton } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Wand2, X } from 'lucide-react';
import type { PasteAnalysis } from '../hooks/usePasteHandler';

interface PasteHintBarProps {
  visible: boolean;
  analysis: PasteAnalysis | null;
  onApply: () => void;
  onDismiss: () => void;
}

export function PasteHintBar({ visible, analysis, onApply, onDismiss }: PasteHintBarProps) {
  const t = useTranslations('scriptEditor');
  const matchPercent = analysis ? Math.round(analysis.matchRate * 100) : 0;

  return (
    <AnimatePresence>
      {visible && analysis && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="sticky top-0 z-10 w-full"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface-inset px-4 py-2.5">
            <Sparkles size={16} className="shrink-0 text-primary" />
            <span className="min-w-0 flex-1 text-sm text-text-secondary">
              {t('paste.detectedDetail', { percent: matchPercent, lines: analysis.suggestions.length })}
            </span>
            <div className="flex items-center gap-2 ml-2">
              <Button variant="secondary"
                type="button"
                onPress={onApply}

              >
                <Wand2 size={12} />
                {t('paste.format')}
              </Button>
              <IconButton
                type="button"
                onPress={onDismiss}

                aria-label={t('paste.dismiss')}
              >
                <X size={14} />
              </IconButton>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default PasteHintBar;
