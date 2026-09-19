"use client";

import { Dialog } from "@omnistudio/ui";
import { X, User, MapPin, Package } from "lucide-react";
import { useTranslations } from "next-intl";
import PreviewImage from "@/components/shared/preview/PreviewImage";
import { holdingReferenceName } from '@/lib/assetReferences';
import { selectedVariantUrl } from "@/lib/characterImage";

interface AssetDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    characters: any[];
    scenes: any[];
    props: any[];
    onSelectAsset: (type: string, name: string) => void;
    selectedNames?: string[];
}

function getAssetThumbnail(item: any, type: "character" | "scene" | "prop"): string | null {
    if (type === "character") {
        const refUrl = selectedVariantUrl(item.reference_sheet);
        if (refUrl) return refUrl;
        const asset = item.full_body_asset || item.headshot_asset;
        if (asset?.selected_id && asset.variants?.length) {
            const selected = asset.variants.find((v: any) => v.id === asset.selected_id);
            if (selected) return selected.url;
        }
        if (asset?.variants?.[0]) return asset.variants[0].url;
        if (item.avatar_url) return item.avatar_url;
    } else {
        const asset = item.image_asset;
        if (asset?.selected_id && asset.variants?.length) {
            const selected = asset.variants.find((v: any) => v.id === asset.selected_id);
            if (selected) return selected.url;
        }
        if (asset?.variants?.[0]) return asset.variants[0].url;
    }
    return null;
}

export default function AssetDrawer({ isOpen, onClose, characters, scenes, props, onSelectAsset, selectedNames = [] }: AssetDrawerProps) {
    const t = useTranslations("storyboardR2V");
    const referenceCharacters = characters.flatMap(c => {
        const unit = c.holding_reference;
        const selected = unit?.image_variants?.find((v: any) => v.id === unit.selected_image_id);
        return selected ? [c, { ...c, id: `${c.id}:holding`, name: holdingReferenceName(c.name), reference_sheet: unit }] : [c];
    });

    const hasAnyAssets = referenceCharacters.length > 0 || scenes.length > 0 || props.length > 0;

    return <Dialog isOpen={isOpen} title={t('assetLibrary')} closeLabel={t('close')}
        onOpenChange={open => { if (!open) onClose(); }} className="!w-[min(420px,calc(100vw-2rem))]">
                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-5">
                            {!hasAnyAssets ? (
                                <div className="text-center py-8">
                                    <p className="text-sm text-text-secondary">{t("noAssetsAvailable")}</p>
                                    <p className="text-xs text-text-secondary/60 mt-1">{t("noAssetsHint")}</p>
                                </div>
                            ) : (
                                <>
                                    {/* Characters */}
                                    {referenceCharacters.length > 0 && (
                                        <div>
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <User size={12} className="text-blue-400" />
                                                <span className="text-[0.6875rem] font-medium text-text-secondary uppercase tracking-wide">{t("characters")}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                {referenceCharacters.map((c: any, i: number) => {
                                                    const thumb = getAssetThumbnail(c, "character");
                                                    return (
                                                        <button
                                                            key={c.id}
                                                            disabled={selectedNames.includes(c.name)}
                                                            aria-label={selectedNames.includes(c.name) ? t("referenceAlreadyAdded", { name: c.name }) : c.name}
                                                            onClick={() => {
                                                                onSelectAsset(`character${i + 1}`, c.name);
                                                                onClose();
                                                            }}
                                                            className="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-glass-border bg-glass hover:border-foreground/30 hover:bg-hover-bg transition-all duration-200 group"
                                                        >
                                                            <div className="w-12 h-12 rounded-lg bg-glass overflow-hidden flex items-center justify-center">
                                                                {thumb ? (
                                                                    <PreviewImage src={thumb} alt={c.name} className="w-full h-full" noLightbox />
                                                                ) : (
                                                                    <User size={16} className="text-text-secondary/40" />
                                                                )}
                                                            </div>
                                                            <span className="text-[0.6875rem] text-foreground group-hover:text-primary truncate w-full text-center">{c.name}</span>
                                                            {selectedNames.includes(c.name) && <span className="text-xs text-primary">{t("referenceSelected")}</span>}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Scenes */}
                                    {scenes.length > 0 && (
                                        <div>
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <MapPin size={12} className="text-green-400" />
                                                <span className="text-[0.6875rem] font-medium text-text-secondary uppercase tracking-wide">{t("scenes")}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                {scenes.map((s: any) => {
                                                    const thumb = getAssetThumbnail(s, "scene");
                                                    return (
                                                        <button
                                                            key={s.id}
                                                            disabled={selectedNames.includes(s.name)}
                                                            aria-label={selectedNames.includes(s.name) ? t("referenceAlreadyAdded", { name: s.name }) : s.name}
                                                            onClick={() => {
                                                                onSelectAsset("scene", s.name);
                                                                onClose();
                                                            }}
                                                            className="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-glass-border bg-glass hover:border-foreground/30 hover:bg-hover-bg transition-all duration-200 group"
                                                        >
                                                            <div className="w-12 h-12 rounded-lg bg-glass overflow-hidden flex items-center justify-center">
                                                                {thumb ? (
                                                                    <PreviewImage src={thumb} alt={s.name} className="w-full h-full" noLightbox />
                                                                ) : (
                                                                    <MapPin size={16} className="text-text-secondary/40" />
                                                                )}
                                                            </div>
                                                            <span className="text-[0.6875rem] text-foreground group-hover:text-primary truncate w-full text-center">{s.name}</span>
                                                            {selectedNames.includes(s.name) && <span className="text-xs text-primary">{t("referenceSelected")}</span>}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Props */}
                                    {props.length > 0 && (
                                        <div>
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <Package size={12} className="text-orange-400" />
                                                <span className="text-[0.6875rem] font-medium text-text-secondary uppercase tracking-wide">{t("props")}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                {props.map((p: any) => {
                                                    const thumb = getAssetThumbnail(p, "prop");
                                                    return (
                                                        <button
                                                            key={p.id}
                                                            disabled={selectedNames.includes(p.name)}
                                                            aria-label={selectedNames.includes(p.name) ? t("referenceAlreadyAdded", { name: p.name }) : p.name}
                                                            onClick={() => {
                                                                onSelectAsset("prop", p.name);
                                                                onClose();
                                                            }}
                                                            className="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-glass-border bg-glass hover:border-foreground/30 hover:bg-hover-bg transition-all duration-200 group"
                                                        >
                                                            <div className="w-12 h-12 rounded-lg bg-glass overflow-hidden flex items-center justify-center">
                                                                {thumb ? (
                                                                    <PreviewImage src={thumb} alt={p.name} className="w-full h-full" noLightbox />
                                                                ) : (
                                                                    <Package size={16} className="text-text-secondary/40" />
                                                                )}
                                                            </div>
                                                            <span className="text-[0.6875rem] text-foreground group-hover:text-primary truncate w-full text-center">{p.name}</span>
                                                            {selectedNames.includes(p.name) && <span className="text-xs text-primary">{t("referenceSelected")}</span>}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
    </Dialog>;
}
