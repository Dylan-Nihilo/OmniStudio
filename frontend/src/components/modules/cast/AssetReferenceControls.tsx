"use client";

import { Button, SelectField } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';
import type { AssetReferenceOption, AssetReferencePurpose, HoldingPosition } from '@/lib/assetReferences';
import { getAssetUrl } from '@/lib/utils';
import styles from './AssetReferenceControls.module.css';

export type ReferenceMode = AssetReferencePurpose | 'none';
export default function AssetReferenceControls({ kind, mode, onModeChange, characters, props, base, sourceId, onSourceChange,
    propIds, onPropsChange, preserveIdentity, onPreserveIdentity, holdingPosition, onHoldingPosition, disabled }: {
    kind: 'character' | 'scene' | 'prop'; mode: ReferenceMode; onModeChange: (mode: ReferenceMode) => void;
    characters: AssetReferenceOption[]; props: AssetReferenceOption[]; base?: AssetReferenceOption;
    sourceId: string; onSourceChange: (id: string) => void; propIds: string[]; onPropsChange: (ids: string[]) => void;
    holdingPosition: HoldingPosition | ''; onHoldingPosition: (value: HoldingPosition) => void;
    preserveIdentity: boolean; onPreserveIdentity: (value: boolean) => void; disabled: boolean;
}) {
    const t = useTranslations('assetWorkflow');
    if (kind === 'scene') return null;
    const modes: ReferenceMode[] = kind === 'character' ? ['character_base', 'character_holding'] : ['prop_extract', 'none'];
    const source = characters.find(item => item.asset_id === sourceId);
    const preview = (ref: AssetReferenceOption) => <div className={styles.preview} key={ref.variant_id}>
        <img src={getAssetUrl(ref.url)} alt={ref.name} /><span>{ref.name}</span>
    </div>;
    return <section className={styles.section} aria-label={t('workflow')}>
        <div className={styles.modes} role="group" aria-label={t('purpose')}>
            {modes.map(value => <Button key={value} variant={mode === value ? 'secondary' : 'quiet'}
                aria-pressed={mode === value} isDisabled={disabled} onPress={() => onModeChange(value)}>{t(`mode.${value}`)}</Button>)}
        </div>
        <p className={styles.hint}>{t(`hint.${mode}`)}</p>
        {mode === 'character_base' && base && <>
            <label className={styles.check}><input type="checkbox" checked={preserveIdentity} disabled={disabled}
                onChange={event => onPreserveIdentity(event.target.checked)} />{t('preserveIdentity')}</label>
            {preserveIdentity && preview(base)}
        </>}
        {mode === 'prop_extract' && <>
            <SelectField label={t('sourceCharacter')} placeholder={t('chooseCharacter')} value={sourceId || null}
                isDisabled={disabled} options={characters.map(item => ({ id: item.asset_id, label: item.name }))}
                onChange={value => onSourceChange(String(value || ''))} />
            {source ? preview(source) : <p className={styles.hint}>{characters.length ? t('chooseSourceHint') : t('noCharacter')}</p>}
        </>}
        {mode === 'character_holding' && <>
            <p className={styles.label}>{t('baseImage')}</p>
            {base ? preview(base) : <p className={styles.hint}>{t('needBase')}</p>}
            <fieldset className={styles.props} disabled={disabled}>
                <legend>{t('chooseProps')}</legend>
                {props.map(ref => <label className={styles.prop} key={ref.asset_id}>
                    <input type="checkbox" checked={propIds.includes(ref.asset_id)}
                        disabled={disabled || (!propIds.includes(ref.asset_id) && propIds.length >= 3)}
                        onChange={event => onPropsChange(event.target.checked ? [...propIds, ref.asset_id] : propIds.filter(id => id !== ref.asset_id))} />
                    {preview(ref)}
                </label>)}
                {!props.length && <p className={styles.hint}>{t('noProps')}</p>}
            </fieldset>
            <fieldset className={styles.props} disabled={disabled}>
                <legend>{t('holdingPosition')}</legend>
                <div className={styles.positions}>{(['right', 'left', 'both', 'wear'] as HoldingPosition[]).map(value => <label key={value} className={styles.check}>
                    <input type="radio" name={`holding-position-${base?.asset_id || 'character'}`} checked={holdingPosition === value} onChange={() => onHoldingPosition(value)} />{t(`position.${value}`)}
                </label>)}</div>
            </fieldset>
            <p className={styles.hint}>{t('holdingInstructions')}</p>
        </>}
    </section>;
}
