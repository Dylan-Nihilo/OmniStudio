"""Resolve asset references within the current production, before generation."""

from typing import Literal

from .models import AssetReferenceInput
from ...utils.model_catalog import load_generated_model_catalog

AssetReferencePurpose = Literal["character_base", "prop_extract", "character_holding"]


HoldingPosition = Literal["left", "right", "both", "wear"]


class AssetReferenceError(ValueError):
    pass


def resolve_asset_references(assets, asset_type, asset_id, purpose, inputs, model_name, holding_position=None):
    if not purpose and inputs:
        raise AssetReferenceError("请选择参考图的用途")
    if purpose and purpose not in ("character_base", "prop_extract", "character_holding"):
        raise AssetReferenceError("不支持的参考图用途")
    if purpose in ("character_base", "character_holding") and asset_type != "character":
        raise AssetReferenceError("人物参考只能用于人物素材")
    if purpose == "prop_extract" and asset_type != "prop":
        raise AssetReferenceError("提取道具只能用于道具素材")
    if purpose == "character_holding" and holding_position not in ("left", "right", "both", "wear"):
        raise AssetReferenceError("请选择持物方式，与剧本中的左右手保持一致")
    if purpose != "character_holding" and holding_position is not None:
        raise AssetReferenceError("持物方式只能用于持物参考")
    refs = [AssetReferenceInput.model_validate(item) for item in (inputs or [])]
    identities = [(ref.asset_type, ref.asset_id, ref.variant_id) for ref in refs]
    if len(refs) > 4 or len(set(identities)) != len(identities):
        raise AssetReferenceError("请选择最多 4 张不重复的参考图")
    if purpose == "character_base" and (len(refs) > 1 or any(ref.asset_type != "character" or ref.asset_id != asset_id for ref in refs)):
        raise AssetReferenceError("基础形象只能沿用该人物的参考图")
    if purpose == "prop_extract" and (len(refs) != 1 or refs[0].asset_type != "character"):
        raise AssetReferenceError("请先选择一张包含该道具的人物参考图")
    if purpose == "character_holding" and (
        len(refs) < 2 or refs[0].asset_type != "character" or refs[0].asset_id != asset_id
        or any(ref.asset_type != "prop" for ref in refs[1:])
        or len({ref.asset_id for ref in refs[1:]}) != len(refs) - 1
    ):
        raise AssetReferenceError("持物参考需要该人物的基础图和至少一件独立道具")
    if refs:
        model = load_generated_model_catalog().get("models", {}).get(model_name, {})
        maximum = model.get("inputs", {}).get("reference_images", {}).get("max", 4)
        if "i2i" not in model.get("capabilities", []) or len(refs) > maximum:
            raise AssetReferenceError("当前模型不支持所选参考图数量，请选择支持参考图的图像模型")
    snapshots = []
    for ref in refs:
        field = "characters" if ref.asset_type == "character" else "props"
        pool = assets.get(field, [])
        asset = next((item for item in pool if item.id == ref.asset_id), None)
        if asset is None:
            raise AssetReferenceError("参考素材不在当前项目可用范围内，请重新选择")
        if ref.asset_type == "character":
            units = [asset.reference_sheet, asset.full_body_asset]
        else:
            units = [asset.image_asset]
        variants = [v for unit in units if unit for v in (getattr(unit, "image_variants", None) or getattr(unit, "variants", []))]
        variant = next((item for item in variants if item.id == ref.variant_id), None)
        if not variant or not variant.url:
            raise AssetReferenceError("参考图片已不存在，请重新选择")
        snapshots.append({**ref.model_dump(), "asset_name": asset.name, "image_url": variant.url})
    return snapshots


def reference_instruction(purpose, snapshots, holding_position=None):
    labels = "\n".join(f"Reference image {i + 1}: {ref['asset_type']} {ref['asset_name']}." for i, ref in enumerate(snapshots))
    if purpose == "character_base":
        instruction = "Create the character's empty-handed base reference. Preserve face, hair, clothing and fixed costume accessories from the reference if provided. Remove handheld and detachable props, including weapons and their scabbards; retain the belt and attachment points. Do not redesign the character."
    elif purpose == "prop_extract":
        instruction = "Extract only the requested prop from reference image 1 onto a neutral background. Preserve its visible silhouette, proportions, materials, colors and fittings exactly. Remove the person and surroundings. Supplement only unseen details explicitly requested by the user; do not invent a different prop design."
    elif purpose == "character_holding":
        instruction = "Create a character-with-prop reference. Image 1 defines the character's identity and costume. Subsequent images define the exact independent props. Preserve both designs and use only these props, at plausible scale. Follow the user's left/right hand and wearing instructions. Do not retain conflicting props from image 1."
    else:
        return ""
    if purpose == "character_holding":
        instruction += " " + {
            "left": "The main prop is held in the character's own LEFT hand; the right hand is free unless otherwise requested.",
            "right": "The main prop is held in the character's own RIGHT hand; the left hand is free unless otherwise requested.",
            "both": "The character holds the main prop with BOTH hands.",
            "wear": "The prop is worn or attached to the costume as requested, with the hands free.",
        }[holding_position]
    return "\n\n" + labels + "\n" + instruction
