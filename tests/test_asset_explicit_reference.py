from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image

from src.apps.comic_gen import api
from src.apps.comic_gen.assets import AssetGenerator
from tests.test_w2_project_api import api_client, _create_project


@pytest.mark.parametrize('generation_type', ['full_body', 'reference_sheet'])
def test_character_edit_forwards_exact_prompt_and_reference(api_client, monkeypatch, generation_type):
    project = _create_project(api_client, 'Reference edit')
    project = api_client.post(f"/projects/{project['id']}/characters", json={'name': 'Lu Lan'}).json()
    ref = Path('output/uploads/reference.png')
    ref.parent.mkdir(parents=True, exist_ok=True)
    Image.new('RGB', (16, 16)).save(ref)
    calls = []

    def generate(prompt, output, **kwargs):
        calls.append((prompt, kwargs))
        Image.new('RGB', (16, 16)).save(output)
        return output, 0

    generator = AssetGenerator()
    monkeypatch.setattr(generator, '_get_model_for', lambda _: SimpleNamespace(generate=generate))
    monkeypatch.setattr(api.pipeline, 'asset_generator', generator)
    result = api_client.post(f"/projects/{project['id']}/assets/generate", json={
        'asset_id': project['characters'][0]['id'], 'asset_type': 'character',
        'generation_type': generation_type, 'prompt': 'Move only the tassel loop.',
        'reference_image_url': 'uploads/reference.png', 'apply_style': False,
    })
    assert result.status_code == 200, result.text
    assert calls[0][0] == 'Move only the tassel loop.'
    assert Path(calls[0][1]['ref_image_path']).resolve() == ref.resolve()


@pytest.mark.parametrize('reference', ['uploads/missing.png', '../outside.png'])
def test_unavailable_reference_never_becomes_unreferenced_generation(api_client, monkeypatch, reference):
    project = _create_project(api_client, 'Invalid reference')
    generator = Mock()
    monkeypatch.setattr(api.pipeline, 'asset_generator', generator)
    with pytest.raises(ValueError):
        api.pipeline.generate_asset(project['id'], 'unused', 'character', reference_image_url=reference)
    generator.generate_character.assert_not_called()
