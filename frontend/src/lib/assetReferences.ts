import type { AssetUnit, Character, ImageAsset } from '@/store/projectStore';

export type HoldingPosition = 'left' | 'right' | 'both' | 'wear';
export type AssetReferencePurpose = 'character_base' | 'prop_extract' | 'character_holding';
export type AssetReferenceInput = { asset_type: 'character' | 'prop'; asset_id: string; variant_id: string };
export type AssetReferenceSnapshot = AssetReferenceInput & { asset_name: string; image_url: string };
export type AssetReferenceOption = AssetReferenceInput & { name: string; url: string };

export function selectedAssetReference(entity: { id: string; name: string; reference_sheet?: AssetUnit; full_body_asset?: ImageAsset; image_asset?: ImageAsset }, kind: 'character' | 'prop'): AssetReferenceOption | undefined {
    const unit = kind === 'character' && entity.reference_sheet?.image_variants?.length ? entity.reference_sheet
        : kind === 'character' ? entity.full_body_asset : entity.image_asset;
    if (!unit) return;
    const variants = 'image_variants' in unit ? unit.image_variants : unit.variants;
    const id = 'selected_image_id' in unit ? unit.selected_image_id : unit.selected_id;
    const selected = variants?.find(item => item.id === id);
    if (selected?.url) return { asset_type: kind, asset_id: entity.id, variant_id: selected.id, name: entity.name, url: selected.url };
}

export function referenceInput(option: AssetReferenceOption): AssetReferenceInput {
    return { asset_type: option.asset_type, asset_id: option.asset_id, variant_id: option.variant_id };
}

export const holdingReferenceName = (name: string) => `${name}（持物）`;
export function findCharacterReference(characters: Character[], name: string): { character: Character; unit: AssetUnit | ImageAsset | undefined } | undefined {
    const base = characters.find(item => item.name === name);
    if (base) return { character: base, unit: base.reference_sheet?.image_variants?.length ? base.reference_sheet : base.full_body_asset };
    const holding = characters.find(item => holdingReferenceName(item.name) === name);
    if (holding) {
        const unit = holding.holding_reference;
        return { character: holding, unit: unit?.image_variants?.some(item => item.id === unit.selected_image_id) ? unit : undefined };
    }
}

/** The same tags feed first-frame rendering and reference-to-video generation. */
export function resolveStoryboardReferenceTags(prompt: string, characters: Character[], scenes: Array<{ name: string; image_asset?: ImageAsset }>, props: Array<{ name: string; image_asset?: ImageAsset }>) {
    const slots = new Map<number, { name: string; url?: string }>();
    const missing = new Set<string>();
    for (const match of prompt.matchAll(/\[character(\d+):([^\]]+)\]/g)) {
        const index = Number(match[1]), name = match[2];
        const previous = slots.get(index);
        if (previous) { if (previous.name !== name) missing.add(name); continue; }
        const ref = findCharacterReference(characters, name);
        const unit = ref?.unit ?? scenes.find(item => item.name === name)?.image_asset ?? props.find(item => item.name === name)?.image_asset;
        const variants = unit && ('image_variants' in unit ? unit.image_variants : unit.variants);
        const selectedId = unit && ('selected_image_id' in unit ? unit.selected_image_id : unit.selected_id);
        const url = variants?.find(item => item.id === selectedId)?.url || variants?.[0]?.url;
        if (!url || index < 1) missing.add(name);
        slots.set(index, { name, url });
    }
    const references = [...slots].sort(([a], [b]) => a - b).map(([, ref]) => ref);
    for (const name of missing) {
        if (!references.some(ref => ref.name === name)) references.push({ name });
    }
    return { references, urls: references.flatMap(ref => ref.url ? [ref.url] : []), missing: [...missing] };
}

/** Remove the binding everywhere without touching prose; keep positional inputs contiguous. */
export function removeStoryboardReference(prompt: string, name: string): string {
    const pattern = /\[character(\d+):([^\]]+)\]/g;
    const remaining = prompt.replace(pattern, (tag, _slot, tagName) => tagName === name ? '' : tag);
    const slots = [...new Set([...remaining.matchAll(pattern)].map(match => Number(match[1])))].sort((a, b) => a - b);
    return remaining.replace(pattern, (_tag, slot, tagName) => `[character${slots.indexOf(Number(slot)) + 1}:${tagName}]`);
}

export function nextReferenceTag(prompt: string, name: string): string {
    const tags = [...prompt.matchAll(/\[character(\d+):([^\]]+)\]/g)];
    const existing = tags.find(match => match[2] === name);
    const slot = existing ? Number(existing[1]) : Math.max(0, ...tags.map(match => Number(match[1]))) + 1;
    return `[character${slot}:${name}]`;
}
