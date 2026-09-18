"use client";

import { CheckCircle2, ChevronRight } from 'lucide-react';
import { Button } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';
import { useProjectStore } from '@/store/projectStore';
import { materialStep, nextStepAfterExtraction, preparationStyle, type PipelineStepId } from '@/lib/pipelineSteps';
import styles from './ProductionGuide.module.css';

export default function ProductionGuide({ stage, ready = 0 }: { stage: 'script' | 'style' | 'assets'; ready?: number }) {
    const t = useTranslations('productionGuide');
    const project = useProjectStore(state => state.currentProject);
    const series = useProjectStore(state => state.currentSeries);
    if (!project) return null;
    const counts = { characters: project.characters?.length || 0, scenes: project.scenes?.length || 0, props: project.props?.length || 0 };
    const total = counts.characters + counts.scenes + counts.props;
    if (!total) return null;
    const style = preparationStyle(project, series);
    const needsStyle = nextStepAfterExtraction(project, series) === 'art_direction';
    const navigate = (step: PipelineStepId) => document.dispatchEvent(new CustomEvent('omni_studio:navigateStep', { detail: step }));
    let title = t('inventorySaved');
    let body = needsStyle ? t('styleNext') : t('assetsNext');
    let destination: PipelineStepId | null = needsStyle ? 'art_direction' : materialStep(project.workflow_mode);
    let action = needsStyle ? t('setStyle') : t('openAssets');
    if (stage === 'style') {
        body = t('styleInstructions'); destination = null;
    } else if (stage === 'assets') {
        title = needsStyle ? t('inventoryReady') : t('createReferences');
        body = needsStyle ? t('styleBeforeImages') : t('referenceInstructions', { name: style?.name || t('currentStyle') });
        destination = needsStyle ? 'art_direction' : null;
        if (!needsStyle && ready === total) {
            title = t('referencesReady'); body = t('storyboardNext'); action = t('openStoryboard');
            destination = project.workflow_mode === 'r2v' ? 'storyboard_r2v' : 'storyboard';
        }
    }
    return <section className={styles.guide} aria-label={t('nextStep')}>
        <CheckCircle2 size={18} aria-hidden="true" />
        <div className={styles.copy}><h2>{title}</h2><p>{t('counts', counts)} · {body}</p></div>
        <div className={styles.actions}>
            {stage === 'script' && needsStyle && <Button variant="quiet" onPress={() => navigate(materialStep(project.workflow_mode))}>{t('viewInventory')}</Button>}
            {destination && <Button variant="secondary" onPress={() => navigate(destination!)}>{action}<ChevronRight size={15} /></Button>}
        </div>
    </section>;
}
