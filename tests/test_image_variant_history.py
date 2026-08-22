"""Tests for CAST-06 image variant history metadata and selection persistence."""

from pathlib import Path
import time

from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.models import Character, ImageAsset, ImageVariant, Script
from src.apps.comic_gen.pipeline import ComicGenPipeline


PNG_1X1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360f8cf00000003000101"
    "180ddc0000000049454e44ae426082"
)


def test_image_variant_history_metadata_defaults_and_serialization():
    variant = ImageVariant(id="variant-1", url="assets/example.png")

    assert variant.model_name is None
    assert variant.params is None
    assert variant.source == "generated"

    serialized = variant.model_dump()
    assert serialized["model_name"] is None
    assert serialized["params"] is None
    assert serialized["source"] == "generated"


def test_character_generation_records_variant_metadata(monkeypatch, tmp_path):
    test_dir = tmp_path / "work"
    test_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.chdir(test_dir)

    class FakeImageModel:
        def generate(self, prompt, output_path, **kwargs):
            output = Path(output_path)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(PNG_1X1)
            return str(output), 0.01

    class FakeUploader:
        is_configured = False

    generator = AssetGenerator({"output_dir": "output/assets"})
    fake_model = FakeImageModel()
    monkeypatch.setattr(generator, "_get_model_for", lambda _model_name: fake_model)
    monkeypatch.setattr("src.utils.oss_utils.OSSImageUploader", FakeUploader)

    character = Character(
        id="character-1",
        name="Ava",
        description="A traveler in a red coat",
    )
    result = generator.generate_character(
        character,
        generation_type="full_body",
        positive_prompt="",
        negative_prompt="no blur",
        batch_size=1,
        model_name="wan2.6-image",
        size="768*1024",
    )

    variant = result.full_body_asset.variants[0]
    assert variant.model_name == "wan2.6-image"
    assert variant.params == {
        "size": "768*1024",
        "negative_prompt": "no blur",
        "seed": None,
    }
    assert variant.source == "generated"
    assert result.full_body_asset.selected_id == variant.id


def test_select_asset_variant_updates_current_image_and_preserves_metadata(monkeypatch):
    first = ImageVariant(
        id="first",
        url="assets/first.png",
        model_name="wan2.6-image",
        params={"size": "768*1024", "seed": 7},
    )
    second = ImageVariant(
        id="second",
        url="assets/second.png",
        model_name="wan2.6-image",
        params={"size": "768*1024", "seed": 8},
    )
    character = Character(
        id="character-1",
        name="Ava",
        description="A traveler in a red coat",
        full_body_asset=ImageAsset(selected_id=first.id, variants=[first, second]),
        full_body_image_url=first.url,
    )
    script = Script(
        id="script-1",
        title="Variant history",
        original_text="A short script",
        characters=[character],
        created_at=time.time(),
        updated_at=time.time(),
    )

    pipeline = object.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    monkeypatch.setattr(pipeline, "_save_data", lambda: None)

    updated = pipeline.select_asset_variant(
        script.id,
        character.id,
        "character",
        second.id,
        generation_type="full_body",
    )

    selected = updated.characters[0].full_body_asset
    assert selected.selected_id == second.id
    assert updated.characters[0].full_body_image_url == second.url
    assert selected.variants[1].params["seed"] == 8
