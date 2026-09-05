"use client";
import { Button, Dialog } from "@omnistudio/ui";
import { Users, MapPin, Box, Check, X } from "lucide-react";
import { useTranslations } from "next-intl";

export interface ExtractionPreview {
    characters: { name: string; description?: string }[];
    scenes: { name: string; description?: string }[];
    props: { name: string; description?: string }[];
}

interface EntityConfirmModalProps {
    isOpen: boolean;
    preview: ExtractionPreview | null;
    currentCounts: { characters: number; scenes: number; props: number };
    isPending?: boolean;
    onConfirm: () => void;
    onDiscard: () => void;
}

export default function EntityConfirmModal({
    isOpen,
    preview,
    currentCounts,
    isPending = false,
    onConfirm,
    onDiscard,
}: EntityConfirmModalProps) {
    const t = useTranslations("script");
    const tc = useTranslations("common");

    if (!preview) return null;

    const sections = [
        { key: "characters" as const, icon: Users, items: preview.characters, prev: currentCounts.characters },
        { key: "scenes" as const, icon: MapPin, items: preview.scenes, prev: currentCounts.scenes },
        { key: "props" as const, icon: Box, items: preview.props, prev: currentCounts.props },
    ];

    return <Dialog isOpen={isOpen} onOpenChange={open => { if (!open && !isPending) onDiscard(); }}
        isDismissable={!isPending} title={t("extractConfirmTitle")} closeLabel={tc("close")}
        footer={<><Button variant="quiet" onPress={onDiscard} isDisabled={isPending}><X size={14} />{t("extractDiscard")}</Button><Button onPress={onConfirm} isPending={isPending}><Check size={14} />{t("extractApply")}</Button></>}>
        <p className="mb-5 text-sm text-text-secondary">{t("extractConfirmSubtitle")}</p>
        <div className="space-y-4">
        {sections.map(({ key, icon: Icon, items, prev }) => (
            <div key={key} className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Icon size={14} />
                    <span className="font-medium">
                        {t(`entityKind_${key}`)}
                    </span>
                    <span className="ml-auto text-xs opacity-70">
                        {prev} → {items.length}
                    </span>
                </div>
                {items.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {items.map((item, i) => (
                            <span
                                key={i}
                                className="inline-flex items-center px-2 py-0.5 rounded-md bg-elevated border border-glass-border text-xs text-foreground"
                                title={item.description}
                            >
                                {item.name}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-text-tertiary italic">{t("noEntities")}</p>
                )}
            </div>
        ))}
        </div>
    </Dialog>;
}
