import rawCatalog from "@/generated/modelCatalog.json";
import { getCanonicalModeEntry, getModelLineEntry } from "@/lib/modelCatalog";

/** Capability groups a generation model can be picked for; text/tts live outside the catalog. */
export type PriceItemKind = "image" | "video" | "text" | "tts";

export interface PriceItemDescription {
    /** What the user sees in the model picker, e.g. "HappyHorse R2V". */
    name: string;
    /** Catalog selection group (i2v / r2v / t2i / image), or null for text and voice. */
    capability: string | null;
    /**
     * False when a generation model has no catalog entry: nobody can select it, so the row
     * is dead weight and safe to delete. Text and voice models are never in the catalog, so
     * they are reported as `true` — their absence is expected, not a problem.
     */
    selectable: boolean;
    /** Vendor family, when the catalog knows it. */
    family: string | null;
}

/**
 * Name a price row the way the generation UI names the same model.
 *
 * Root should not have to read `happyhorse/happyhorse-1.1-video#r2v` to know which row is
 * which, and a price attached to a model users cannot pick should be visibly useless.
 */
export function describePriceItem(item: { model_id: string; stage: PriceItemKind; display_name?: string }): PriceItemDescription {
    if (item.stage === "text" || item.stage === "tts") {
        // text/deepseek-v4-flash -> "deepseek-v4-flash"; the seed's tier ("标准") is a better label when present.
        const bare = item.model_id.includes("/") ? item.model_id.split("/").slice(1).join("/") : item.model_id;
        return {
            name: item.display_name ? `${item.display_name} · ${bare}` : bare,
            capability: null,
            selectable: true,
            family: null,
        };
    }

    const mode = getCanonicalModeEntry(item.model_id) as {
        display_name?: string; family?: string; ui?: { selection_group?: string };
    } | null;
    if (mode) {
        return {
            name: mode.display_name || item.model_id,
            capability: mode.ui?.selection_group ?? null,
            selectable: true,
            family: mode.family ?? null,
        };
    }

    // Unknown mode id: fall back to the model line (id minus the #mode suffix) for a nicer name.
    const line = getModelLineEntry(item.model_id.split("#")[0]) as { display_name?: string } | null;
    return {
        name: line?.display_name || item.display_name || item.model_id,
        capability: item.model_id.includes("#") ? item.model_id.split("#")[1] : null,
        selectable: false,
        family: null,
    };
}

/**
 * Spec keys as stored in a price row, split into label/value pairs for display.
 * Values stay verbatim (1080p, pro, high) because that is what users see in the parameter
 * controls; only the key gets a translated label.
 */
export function describeSpec(match: Record<string, unknown>): { key: string; value: string }[] {
    return Object.entries(match).map(([key, value]) => ({
        key,
        value: value === true ? "" : String(value),
    }));
}

/**
 * next-intl throws on a missing key, and both of these come from catalog data rather than a
 * fixed list, so callers must check before translating.
 */
export const TRANSLATED_CAPABILITIES = new Set(["i2v", "r2v", "t2v", "v2v", "t2i", "i2i", "image", "videoedit"]);
export const TRANSLATED_SPEC_KEYS = new Set(["resolution", "mode", "audio", "size_tier", "quality", "direction", "variant"]);

const SELECTION_GROUPS: Record<"image" | "video", readonly string[]> = {
    image: ["image", "t2i", "i2i"],
    video: ["i2v", "r2v", "t2v", "v2v"],
};

export interface CatalogMode {
    id: string;
    name: string;
    capability: string;
}

/**
 * Active, user-visible catalog modes for a billing stage.
 *
 * Used to spot the dangerous gap: a model the picker offers but the price book does not
 * cover fails with PRICING_ITEM_NOT_FOUND the moment billing is switched on.
 */
export function catalogModesForStage(stage: PriceItemKind): CatalogMode[] {
    if (stage !== "image" && stage !== "video") return [];
    const groups = SELECTION_GROUPS[stage];
    const modes = (rawCatalog as { modes: Record<string, any> }).modes ?? {};
    return Object.entries(modes)
        .filter(([, mode]) => mode?.status === "active"
            && (mode?.ui?.visible_in?.length ?? 0) > 0
            && groups.includes(mode?.ui?.selection_group))
        .map(([id, mode]) => ({ id, name: mode.display_name || id, capability: mode.ui.selection_group }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
