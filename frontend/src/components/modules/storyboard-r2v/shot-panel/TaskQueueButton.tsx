"use client";

import { ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@omnistudio/ui";

export default function TaskQueueButton({ inFlightCount, open, onToggle }: { inFlightCount: number; open: boolean; onToggle: () => void }) {
    const t = useTranslations("storyboardR2V");
    return <Button variant={open ? "secondary" : "quiet"} onPress={onToggle} aria-expanded={open} aria-controls={open ? "studio-task-queue" : undefined} aria-label={t("queueSummary", { count: inFlightCount })}>
        <ListChecks size={16} aria-hidden="true" />{t("queueTitle")}
        {inFlightCount > 0 && <span aria-hidden="true" className="font-mono text-xs tabular-nums">{inFlightCount}</span>}
    </Button>;
}
