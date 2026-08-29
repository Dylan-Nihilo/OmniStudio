import type { Character, ImageAsset, ImageVariant, AssetUnit } from "@/store/projectStore";

/**
 * Character image resolution helpers.
 *
 * Characters store images in two containers from two schema eras:
 *   - reference_sheet (new, canonical): { image_variants, selected_image_id }
 *   - full_body_asset (legacy):         { variants, selected_id }
 *
 * New characters are written to reference_sheet only, so every consumer must
 * read reference_sheet first and fall back to full_body_asset — otherwise newly
 * generated characters render blank. Centralised here so call sites can't drift.
 *
 * NOTE: this is for resolving a character's *display / reference* image. It is
 * NOT for full_body-specific management UI (e.g. CharacterWorkbench panels that
 * edit the full_body asset type itself).
 */

/** Selected (or first) variant URL from EITHER container shape. */
export function selectedVariantUrl(asset?: ImageAsset | AssetUnit | null): string | undefined {
  if (!asset) return undefined;
  const variants = "image_variants" in asset ? asset.image_variants : asset.variants;
  if (!Array.isArray(variants) || variants.length === 0) return undefined;
  const selectedId = "image_variants" in asset ? asset.selected_image_id : asset.selected_id;
  const selected = variants.find((v) => v.id === selectedId);
  return selected?.url || variants[0]?.url;
}

/** Resolve a character's primary image container to a normalized ImageAsset
 *  ({ variants, selected_id }), preferring reference_sheet over legacy full_body. */
export function characterImageAsset(c: Character): ImageAsset | undefined {
  const rs = c.reference_sheet;
  if (Array.isArray(rs?.image_variants) && rs.image_variants.length > 0) {
    return { selected_id: rs.selected_image_id, variants: rs.image_variants };
  }
  return c.full_body_asset;
}

/** A character's variant list (reference_sheet → full_body), for counts / variant strips. */
export function characterVariants(c: Character): ImageVariant[] {
  const variants = characterImageAsset(c)?.variants;
  return Array.isArray(variants) ? variants : [];
}

/** A character's best display image: reference_sheet → full_body → legacy top-level urls. */
export function characterImageUrl(c: Character): string | undefined {
  return selectedVariantUrl(characterImageAsset(c)) || c.image_url || c.full_body_image_url;
}
