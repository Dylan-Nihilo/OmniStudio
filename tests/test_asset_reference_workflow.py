from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from src.apps.comic_gen import api
from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.models import AssetUnit, ImageAsset, ImageVariant
from tests.test_w2_project_api import api_client, _create_project


@pytest.mark.parametrize('kind', ['characters', 'scenes', 'props'])
def test_legacy_master_migrates_once_without_reviving_cleared_candidates(kind):
    from src.apps.comic_gen.models import Character, Scene, Prop
    from src.apps.comic_gen.production_planning import reference_assets

    model = {'characters': Character, 'scenes': Scene, 'props': Prop}[kind]
    field = 'full_body_image_url' if kind == 'characters' else 'image_url'
    asset = model.model_validate({'id': 'legacy', 'name': 'Old master',
                                 'description': '', field: 'uploads/old.png'})
    assets = {key: [asset] if key == kind else [] for key in ('characters', 'scenes', 'props')}
    assert reference_assets(assets)[asset.name][2] == 'uploads/old.png'
    unit = asset.reference_sheet if kind == 'characters' else asset.image_asset
    variants = unit.image_variants if kind == 'characters' else unit.variants
    original_id = variants[0].id
    restored = model.model_validate(asset.model_dump())
    restored_unit = restored.reference_sheet if kind == 'characters' else restored.image_asset
    assert (restored_unit.image_variants if kind == 'characters' else restored_unit.variants)[0].id == original_id
    variants.clear()
    if kind == 'characters':
        unit.selected_image_id = None
    else:
        unit.selected_id = None
    # Even a stale legacy URL must not resurrect a deliberately cleared pool.
    restored = model.model_validate(asset.model_dump())
    assets[kind] = [restored]
    assert reference_assets(assets)[asset.name][2] is None


@pytest.mark.parametrize('scope', ['projects', 'series'])
@pytest.mark.parametrize('kind', ['characters', 'scenes', 'props'])
def test_create_uploaded_asset_is_selected_reference_after_reload(api_client, scope, kind):
    from src.apps.comic_gen.models import Script, Series
    from src.apps.comic_gen.production_planning import reference_assets

    if scope == 'projects':
        parent = _create_project(api_client, 'Uploaded master')
    else:
        response = api_client.post('/series', json={'title': 'Uploaded master'})
        assert response.status_code == 200, response.text
        parent = response.json()
    route = f"/{scope}/{parent['id']}"
    response = api_client.post(route + '/' + kind, json={
        'name': 'Uploaded reference', 'image_url': 'uploads/master.png',
    })
    assert response.status_code == 200, response.text
    response = api_client.get(route)
    assert response.status_code == 200, response.text
    model = Script if scope == 'projects' else Series
    restored = model.model_validate(response.json())
    assets = {key: getattr(restored, key) for key in ('characters', 'scenes', 'props')}
    asset = assets[kind][0]
    assert reference_assets(assets)[asset.name][2] == 'uploads/master.png'
    unit = asset.reference_sheet if kind == 'characters' else asset.image_asset
    variants = unit.image_variants if kind == 'characters' else unit.variants
    selected = unit.selected_image_id if kind == 'characters' else unit.selected_id
    assert len(variants) == 1
    assert variants[0].id == selected
    assert variants[0].is_uploaded_source


@pytest.mark.parametrize('kind', ['characters', 'scenes', 'props'])
def test_legacy_master_does_not_override_existing_selection(kind):
    from src.apps.comic_gen.models import Character, Scene, Prop

    model = {'characters': Character, 'scenes': Scene, 'props': Prop}[kind]
    container = {'image_variants': [{'id': 'keep', 'url': 'uploads/selected.png'}],
                 'selected_image_id': 'keep'} if kind == 'characters' else {
                     'variants': [{'id': 'keep', 'url': 'uploads/selected.png'}], 'selected_id': 'keep'}
    asset = model.model_validate({
        'id': 'legacy', 'name': 'Existing selection', 'description': '', 'image_url': 'uploads/stale.png',
        'reference_sheet' if kind == 'characters' else 'image_asset': container,
    })
    unit = asset.reference_sheet if kind == 'characters' else asset.image_asset
    variants = unit.image_variants if kind == 'characters' else unit.variants
    assert [variant.id for variant in variants] == ['keep']
    assert (unit.selected_image_id if kind == 'characters' else unit.selected_id) == 'keep'


def setup_assets(client, monkeypatch):
    project = _create_project(client, 'Reference workflow')
    route = f"/projects/{project['id']}"
    client.post(route + '/characters', json={'name': '陆青'})
    client.post(route + '/props', json={'name': '佩剑'})
    script = api.pipeline.scripts[project['id']]
    character, prop = script.characters[0], script.props[0]
    source = Path('output/uploads/character.png')
    source.parent.mkdir(parents=True, exist_ok=True)
    Image.new('RGB', (16, 16), 'blue').save(source)
    character.reference_sheet = AssetUnit(selected_image_id='base-1', image_variants=[ImageVariant(id='base-1', url='uploads/character.png')])
    character.image_url = 'uploads/character.png'
    api.pipeline._save_data()
    calls = []

    def generate(prompt, output, **kwargs):
        calls.append((prompt, kwargs))
        Image.new('RGB', (16, 16), 'green').save(output)
        return output, 0

    generator = AssetGenerator()
    monkeypatch.setattr(generator, '_get_model_for', lambda _: SimpleNamespace(generate=generate))
    monkeypatch.setattr(api.pipeline, 'asset_generator', generator)
    return script.id, character.id, prop.id, calls


def ref(kind, asset_id, variant_id):
    return {'asset_type': kind, 'asset_id': asset_id, 'variant_id': variant_id}


def generate(client, pid, target, kind, purpose, refs):
    return client.post(f'/projects/{pid}/assets/generate', json={
        'asset_id': target, 'asset_type': kind, 'reference_purpose': purpose, 'reference_inputs': refs,
        'generation_type': 'holding_reference' if purpose == 'character_holding' else 'reference_sheet' if kind == 'character' else 'all',
        'holding_position': 'right' if purpose == 'character_holding' else None,
        'model_name': 'gpt-image-2', 'prompt': 'Preserve the design.', 'apply_style': False, 'batch_size': 1,
    })


def test_extract_base_and_holding_round_trip_with_real_image_pipeline(api_client, monkeypatch):
    pid, cid, prop_id, calls = setup_assets(api_client, monkeypatch)
    base_ref = ref('character', cid, 'base-1')
    response = generate(api_client, pid, prop_id, 'prop', 'prop_extract', [base_ref])
    assert response.status_code == 200, response.text
    assert Path(calls[-1][1]['ref_image_path']).resolve() == Path('output/uploads/character.png').resolve()
    assert 'Extract only the requested prop' in calls[-1][0]
    stored = api.pipeline.scripts[pid]
    prop_image = stored.props[0].image_asset.variants[0]
    assert prop_image.params['reference_inputs'][0]['variant_id'] == 'base-1'
    assert prop_image.params['reference_inputs'][0]['image_url'] == 'uploads/character.png'
    prop_ref = ref('prop', prop_id, prop_image.id)

    response = generate(api_client, pid, cid, 'character', 'character_base', [base_ref])
    assert response.status_code == 200, response.text
    assert 'empty-handed base reference' in calls[-1][0]
    char = api.pipeline.scripts[pid].characters[0]
    assert char.reference_sheet.selected_image_id == 'base-1'
    assert char.image_url == 'uploads/character.png'
    new_base = char.reference_sheet.image_variants[-1]
    selected = api_client.post(f'/projects/{pid}/assets/variant/select', json={
        'asset_id': cid, 'asset_type': 'character', 'variant_id': new_base.id, 'generation_type': 'reference_sheet',
    })
    assert selected.status_code == 200, selected.text
    base_ref = ref('character', cid, new_base.id)

    response = generate(api_client, pid, cid, 'character', 'character_holding', [base_ref, prop_ref])
    assert response.status_code == 200, response.text
    assert len(calls[-1][1]['ref_image_paths']) == 1
    assert "RIGHT hand" in calls[-1][0]
    assert Path(calls[-1][1]['ref_image_path']).resolve() == Path('output', new_base.url).resolve()
    assert Path(calls[-1][1]['ref_image_paths'][0]).resolve() == Path('output', prop_image.url).resolve()
    char = api.pipeline.scripts[pid].characters[0]
    assert char.reference_sheet.selected_image_id == new_base.id
    assert char.image_url == new_base.url
    holding = char.holding_reference.image_variants[0]
    assert [x['asset_type'] for x in holding.params['reference_inputs']] == ['character', 'prop']
    assert char.holding_reference.selected_image_id == holding.id
    assert holding.params['holding_position'] == 'right'
    # Regeneration keeps selected base, prop and holding variants intact.
    response = generate(api_client, pid, cid, 'character', 'character_holding', [base_ref, prop_ref])
    assert response.status_code == 200
    char = api.pipeline.scripts[pid].characters[0]
    assert char.holding_reference.selected_image_id == holding.id
    second = char.holding_reference.image_variants[-1]
    selected = api_client.post(f'/projects/{pid}/assets/variant/select', json={
        'asset_id': cid, 'asset_type': 'character', 'variant_id': second.id, 'generation_type': 'holding_reference',
    })
    assert selected.status_code == 200, selected.text
    loaded = api.pipeline.repository.load_scripts()[pid]
    assert loaded.characters[0].holding_reference.selected_image_id == second.id
    assert loaded.characters[0].image_url == new_base.url
    response = generate(api_client, pid, prop_id, 'prop', 'prop_extract', [base_ref])
    assert response.status_code == 200
    assert api.pipeline.scripts[pid].props[0].image_asset.selected_id == prop_image.id


@pytest.mark.parametrize('bad', ['other_project', 'missing_variant', 'missing_file', 'wrong_type', 'unsupported_model', 'both_urls', 'holding_without_prop'])
def test_invalid_references_fail_before_model_or_task_creation(api_client, monkeypatch, bad):
    pid, cid, prop_id, calls = setup_assets(api_client, monkeypatch)
    data = {'asset_id': prop_id, 'asset_type': 'prop', 'reference_purpose': 'prop_extract',
            'reference_inputs': [ref('character', cid, 'base-1')], 'model_name': 'gpt-image-2'}
    if bad == 'other_project':
        other = _create_project(api_client, 'Unrelated')
        other = api_client.post(f"/projects/{other['id']}/characters", json={'name': 'Other'}).json()
        data['reference_inputs'][0]['asset_id'] = other['characters'][0]['id']
    elif bad == 'missing_variant':
        data['reference_inputs'][0]['variant_id'] = 'missing'
    elif bad == 'missing_file':
        Path('output/uploads/character.png').unlink()
    elif bad == 'wrong_type':
        data['reference_inputs'] = [ref('prop', prop_id, 'base-1')]
    elif bad == 'unsupported_model':
        data['model_name'] = 'unsupported-image-model'
    elif bad == 'both_urls':
        data['reference_image_url'] = 'uploads/character.png'
    else:
        data.update(asset_id=cid, asset_type='character', reference_purpose='character_holding', generation_type='holding_reference')
    count = len(api.pipeline.asset_generation_tasks)
    response = api_client.post(f'/projects/{pid}/assets/generate', json=data)
    assert response.status_code == 400, response.text
    assert calls == []
    assert len(api.pipeline.asset_generation_tasks) == count


def test_references_reach_openai_edit_multipart_transport(api_client, monkeypatch):
    import base64
    from src.models import mulerouter
    pid, cid, prop_id, _ = setup_assets(api_client, monkeypatch)
    monkeypatch.setattr(mulerouter, '_openai_image_selected', lambda: True)
    monkeypatch.setattr(mulerouter, '_get_openai_image_config', lambda model_id='': {
        'api_key': 'fixture-only', 'base_url': 'https://images.invalid/v1', 'model': 'gpt-image-2',
    })
    uploads = []
    image_bytes = Path('output/uploads/character.png').read_bytes()

    def transport(method, url, **kwargs):
        assert method == 'POST' and url.endswith('/images/edits')
        uploads.append([file[1][1].read() for file in kwargs['files']])
        return SimpleNamespace(json=lambda: {'data': [{'b64_json': base64.b64encode(image_bytes).decode()}]})

    monkeypatch.setattr(mulerouter, '_request_with_retry', transport)
    model = mulerouter.MuleRouterImageModel({})
    monkeypatch.setattr(api.pipeline.asset_generator, '_get_model_for', lambda _: model)
    base = ref('character', cid, 'base-1')
    result = generate(api_client, pid, prop_id, 'prop', 'prop_extract', [base])
    assert result.status_code == 200, result.text
    prop = api.pipeline.scripts[pid].props[0].image_asset.variants[0]
    result = generate(api_client, pid, cid, 'character', 'character_holding', [base, ref('prop', prop_id, prop.id)])
    assert result.status_code == 200, result.text
    assert uploads == [[image_bytes], [image_bytes, Path('output', prop.url).read_bytes()]]


@pytest.mark.parametrize('same_workspace', [True, False])
def test_shared_library_references_follow_workspace_scope(api_client, monkeypatch, same_workspace):
    pid, _, prop_id, calls = setup_assets(api_client, monkeypatch)
    workspace_id = api.pipeline.repository.workspace_for_script(pid)
    library_char = api.pipeline.create_library_asset('character', {
        'name': 'Library actor', 'description': 'Actor', 'image_url': 'uploads/character.png',
    }, workspace_id=workspace_id if same_workspace else 'another-workspace')
    source = ref('character', library_char.id, library_char.reference_sheet.selected_image_id)
    response = generate(api_client, pid, prop_id, 'prop', 'prop_extract', [source])
    assert response.status_code == (200 if same_workspace else 400), response.text
    assert bool(calls) == same_workspace
