"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Check } from 'lucide-react';
import { Checkbox, IconButton, PasswordField } from '@omnistudio/ui';

export function SectionCard({id, title, desc, children}: {id?: string; title: string; desc?: string; children: ReactNode}) {
  return <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="min-w-0">
    <div className="border-b border-glass-border pb-4">
      <h2 id={id ? `${id}-title` : undefined} className="text-lg font-semibold text-foreground">{title}</h2>
      {desc && <p className="mt-1 text-sm leading-6 text-text-muted">{desc}</p>}
    </div>
    <div>{children}</div>
  </section>;
}

export function FormRow({label, hint, children}: {label: string; hint?: string; children: ReactNode}) {
  return <div role="group" aria-label={label} className="grid min-w-0 gap-4 border-b border-glass-border py-6 last:border-b-0 lg:grid-cols-[minmax(180px,0.9fr)_minmax(0,1.1fr)] lg:gap-10">
    <div className="min-w-0"><h3 className="text-sm font-medium text-foreground">{label}</h3>{hint && <p className="mt-1 text-xs leading-6 text-text-muted">{hint}</p>}</div>
    <div className="min-w-0">{children}</div>
  </div>;
}

export function KeyField({label, value, onChange, placeholder, isDisabled = false}: {label: string; value: string; onChange: (value: string) => void; placeholder?: string; isDisabled?: boolean}) {
  const t = useTranslations('settings');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const masked = value.includes('•');
  useEffect(() => {
    setCopyState('idle');
    return () => {if (resetTimer.current) clearTimeout(resetTimer.current);};
  }, [value]);
  const copy = async () => {
    if (!value || masked) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopyState('idle'), 1500);
    } catch {setCopyState('error');}
  };
  const field = {label, value, onChange, placeholder, isDisabled, autoComplete:'off', className:'min-w-0 flex-1 [&_input]:font-mono'};
  return <div className="min-w-0">
    <div className="flex items-end gap-2">
      <PasswordField {...field} isRevealDisabled={masked} showPasswordLabel={t('showKey')} hidePasswordLabel={t('hideKey')} />
      <IconButton aria-label={t('copyKey')} isDisabled={isDisabled || !value || masked} onPress={copy}>{copyState === 'copied' ? <Check size={16} /> : <Copy size={16} />}</IconButton>
    </div>
    <p role={copyState === 'error' ? 'alert' : 'status'} className={`mt-2 text-xs leading-5 ${copyState === 'error' ? 'text-status-failed-fg' : 'text-text-muted'}`}>
      {copyState === 'error' ? t('copyFailed') : copyState === 'copied' ? t('copied') : masked ? t('maskedKeyHint') : value.trim() ? t('filled') : t('notConfigured')}
    </p>
  </div>;
}

export function Toggle({checked, onChange, label, sub, ariaLabel, isDisabled}: {checked: boolean; onChange: (value: boolean) => void; label: string; sub?: string; ariaLabel?: string; isDisabled?: boolean}) {
  return <Checkbox isSelected={checked} onChange={onChange} aria-label={ariaLabel || label} isDisabled={isDisabled} description={sub}>{label}</Checkbox>;
}
