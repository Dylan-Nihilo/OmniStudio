'use client';

import { Button, SelectField } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';
import { usePlaygroundStore, type PlaygroundMode } from './usePlaygroundStore';
import styles from './PlaygroundPage.module.css';

const GROUPS: { label: string; modes: PlaygroundMode[] }[] = [
  { label: 'groupImage', modes: ['t2i', 'i2i'] },
  { label: 'groupVideo', modes: ['t2v', 'i2v', 'r2v', 'v2v'] },
];

export default function ModeSelector() {
  const t = useTranslations('playground');
  const mode = usePlaygroundStore(s => s.mode);
  const setMode = usePlaygroundStore(s => s.setMode);
  return <nav className={styles.navigation} aria-label={t('compose.modeLabel')}>
    <h2>{t('compose.modeLabel')}</h2>
    {GROUPS.map(group => <div key={group.label} className={styles.modeGroup}>
      <p>{t(`mode.${group.label}`)}</p>
      {group.modes.map(key => <Button key={key} variant="quiet" aria-pressed={mode === key} onPress={() => setMode(key)}>{t(`mode.${key}`)}</Button>)}
    </div>)}
    <div className={styles.mobileMode}><SelectField label={t('compose.modeLabel')} value={mode} onChange={key => setMode(key as PlaygroundMode)} options={GROUPS.flatMap(group => group.modes.map(key => ({ id: key, label: t(`mode.${key}`) })))} /></div>
  </nav>;
}
