"use client";
import { Button, Checkbox, Dialog } from "@omnistudio/ui";
import { Users, MapPin, Box, Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export interface ExtractionPreview {
    characters: { id?: string; name: string; description?: string }[];
    scenes: { id?: string; name: string; description?: string }[];
    props: { id?: string; name: string; description?: string }[];
}

interface EntityConfirmModalProps {
    isOpen: boolean;
    preview: ExtractionPreview | null;
    currentCounts: { characters: number; scenes: number; props: number };
    isPending?: boolean;
    onConfirm: (selection: ExtractionPreview) => void;
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
    const [selected, setSelected] = useState<Record<keyof ExtractionPreview, Set<string>>>({
        characters: new Set(),
        scenes: new Set(),
        props: new Set(),
    });

    useEffect(() => {
        if (!preview) return;
        setSelected({
            characters: new Set(preview.characters.map((item, index) => item.id ?? String(index))),
            scenes: new Set(preview.scenes.map((item, index) => item.id ?? String(index))),
            props: new Set(preview.props.map((item, index) => item.id ?? String(index))),
        });
    }, [preview]);

    if (!preview) return null;

    const sections = [
        { key: "characters" as const, icon: Users, items: preview.characters, prev: currentCounts.characters },
        { key: "scenes" as const, icon: MapPin, items: preview.scenes, prev: currentCounts.scenes },
        { key: "props" as const, icon: Box, items: preview.props, prev: currentCounts.props },
    ];

    const toggle = (key: keyof ExtractionPreview, itemKey: string) => {
        setSelected(current => {
            const next = new Set(current[key]);
            if (next.has(itemKey)) next.delete(itemKey);
            else next.add(itemKey);
            return { ...current, [key]: next };
        });
    };

    const confirmSelection = () => onConfirm({
        characters: preview.characters.filter((item, index) => selected.characters.has(item.id ?? String(index))),
        scenes: preview.scenes.filter((item, index) => selected.scenes.has(item.id ?? String(index))),
        props: preview.props.filter((item, index) => selected.props.has(item.id ?? String(index))),
    });

    return <Dialog isOpen={isOpen} onOpenChange={open => { if (!open && !isPending) onDiscard(); }}
        isDismissable={!isPending} title={t("extractConfirmTitle")} closeLabel={tc("close")}
        footer={<><Button variant="quiet" onPress={onDiscard} isDisabled={isPending}><X size={14} />{t("extractDiscard")}</Button><Button onPress={confirmSelection} isPending={isPending}><Check size={14} />{t("extractApply")}</Button></>}>
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
                            <Checkbox
                                key={i}
                                isSelected={selected[key].has(item.id ?? String(i))}
                                onChange={() => toggle(key, item.id ?? String(i))}
                                isDisabled={isPending}
                                aria-label={item.name}
                                className="inline-flex items-center px-2 py-0.5 rounded-md bg-elevated border border-glass-border text-xs text-foreground"
                                description={item.description}
                            >{item.name}</Checkbox>
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
