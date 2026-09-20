"use client";

import { Button, EmptyState, LoadingState } from "@omnistudio/ui";

interface ProjectLoadStateProps {
    loading: boolean;
    loadFailed: boolean;
    onRetry: () => void;
    onBack: () => void;
    loadingLabel: string;
    loadFailedLabel: string;
    retryLabel: string;
    backLabel: string;
}

export default function ProjectLoadState({
    loading,
    loadFailed,
    onRetry,
    onBack,
    loadingLabel,
    loadFailedLabel,
    retryLabel,
    backLabel,
}: ProjectLoadStateProps) {
    if (!loading && !loadFailed) return null;

    if (loading) {
        return <div data-testid="project-load-state" className="h-full" aria-busy="true"><LoadingState label={loadingLabel} /></div>;
    }

    return <div data-testid="project-load-state" className="h-full" aria-busy="false" role="alert">
        <EmptyState title={loadFailedLabel} action={<div className="flex flex-wrap justify-center gap-2">
            <Button onPress={onRetry}>{retryLabel}</Button>
            <Button variant="quiet" onPress={onBack}>{backLabel}</Button>
        </div>} />
    </div>;
}
