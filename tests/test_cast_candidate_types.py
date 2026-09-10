from pathlib import Path

from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.models import Character


class _ImageModel:
    def generate(self, _prompt, output_path, **_kwargs):
        Path(output_path).write_bytes(b"image")
        return output_path


def test_character_reference_candidate_persists_template_type(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    generator = AssetGenerator({"output_dir": "output/assets"})
    generator.model = _ImageModel()
    character = Character(id="character-1", name="Mira", description="pilot")

    updated = generator.generate_character(
        character,
        generation_type="reference_sheet",
        prompt="three view reference",
        batch_size=1,
        candidate_type="detailed",
    )

    assert updated.reference_sheet.image_variants[0].candidate_type == "detailed"
