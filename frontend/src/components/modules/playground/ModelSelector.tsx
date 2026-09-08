'use client';

import { useEffect, useMemo } from 'react';
import { SelectField } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';
import { usePlaygroundStore } from './usePlaygroundStore';
import { getModelsForMode } from './playgroundModels';

export default function ModelSelector() {
  const mode = usePlaygroundStore(s => s.mode);
  const modelId = usePlaygroundStore(s => s.modelId);
  const setModelId = usePlaygroundStore(s => s.setModelId);
  const t = useTranslations('playground');
  const availableModels = useMemo(() => getModelsForMode(mode), [mode]);

  useEffect(() => {
    if (availableModels.length > 0 && !availableModels.some(model => model.id === modelId)) {
      setModelId(availableModels[0].id);
    }
  }, [availableModels, modelId, setModelId]);

  return <SelectField label={t('compose.modelLabel')} value={modelId} onChange={key => setModelId(String(key))}
    isDisabled={availableModels.length === 0} description={availableModels.length === 0 ? t('model.noModels') : undefined}
    options={availableModels.map(model => ({ id: model.id, label: model.displayName, description: `${model.family}${model.recommended ? ` · ${t('model.recommended')}` : ''}` }))} />;
}
