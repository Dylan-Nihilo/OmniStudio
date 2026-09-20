'use client';

import { useEffect, useMemo } from 'react';
import { SelectField } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';
import { usePlaygroundStore } from './usePlaygroundStore';
import { getModelsForMode } from './playgroundModels';
import { creditLabel, unitLabels } from '@/lib/modelCost';
import { usePricingTable } from '@/store/billingStore';

export default function ModelSelector() {
  const mode = usePlaygroundStore(s => s.mode);
  const modelId = usePlaygroundStore(s => s.modelId);
  const setModelId = usePlaygroundStore(s => s.setModelId);
  const t = useTranslations('playground');
  const tBilling = useTranslations('billing');
  const pricing = usePricingTable();
  const availableModels = useMemo(() => getModelsForMode(mode), [mode]);

  useEffect(() => {
    if (availableModels.length > 0 && !availableModels.some(model => model.id === modelId)) {
      setModelId(availableModels[0].id);
    }
  }, [availableModels, modelId, setModelId]);

  return <SelectField label={t('compose.modelLabel')} value={modelId} onChange={key => setModelId(String(key))}
    isDisabled={availableModels.length === 0} description={availableModels.length === 0 ? t('model.noModels') : undefined}
    options={availableModels.map(model => {
      // The rate leads the description: in a sandbox people try models back to back, so
      // what each one costs is the thing worth seeing before picking.
      const rate = creditLabel(pricing, model.id, unitLabels(tBilling));
      const detail = `${model.family}${model.recommended ? ` · ${t('model.recommended')}` : ''}`;
      return { id: model.id, label: model.displayName, description: rate ? `${rate} · ${detail}` : detail };
    })} />;
}
