"use client";

import { Button } from "@omnistudio/ui";

interface StoryboardAnalysisFeedbackProps {
    error: string;
    success: string;
    retryLabel: string;
    onRetry: () => void;
}

export default function StoryboardAnalysisFeedback({ error, success, retryLabel, onRetry }: StoryboardAnalysisFeedbackProps) {
    if (error) {
        return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-failed-border bg-status-failed-bg px-3 py-2 text-sm text-status-failed-fg">
            <span className="min-w-0 whitespace-pre-wrap">{error}</span>
            <Button variant="quiet" size="sm" onPress={onRetry}>{retryLabel}</Button>
        </div>;
    }
    if (success) return <p role="status" className="text-sm text-status-completed-fg">{success}</p>;
    return null;
}
