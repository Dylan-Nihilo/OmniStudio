import copy
from pathlib import Path

import pytest
from pydantic import ValidationError

from src.apps.comic_gen import api as api_module
from src.apps.comic_gen.audio_config import resolve_video_audio_options
from src.apps.comic_gen.models import OmniReferenceSettings, AssetUnit, ImageAsset, ImageVariant
from src.apps.comic_gen.omni_reference import supports_omni_reference
from src.models.jojokey import JojoKeyVideoModel
from tests.test_w2_project_api import api_client
from tests.test_production_planning import setup_plan, generate
from tests.test_jojokey_provider import recorder, _submit_body


SETTINGS = {'videos': [{'url': 'https://example.test/action.mp4', 'purpose': '只参考步伐和运镜'}],
            'audios': [{'url': 'https://example.test/lu.wav', 'purpose': '参考陆青音色'},
                       {'url': 'https://example.test/shen.wav', 'purpose': '参考沈砚音色'}], 'audio_mode': 'driven'}


@pytest.mark.parametrize('mode', ['native', 'driven'])
def test_seedance_uses_actual_jojokey_audio_capability(mode):
    result = resolve_video_audio_options(model='seedance-2.5-r2v', audio_mode=mode,
        audio_url='https://example.test/voice.wav' if mode == 'driven' else None)
    assert result['audio'] is True
    assert supports_omni_reference('seedance/seedance-2.5-video#r2v')
    with pytest.raises(ValueError, match='does not support native'):
        resolve_video_audio_options(model='mulerouter/seedance-2.0', audio_mode='native', audio_url=None)


@pytest.mark.parametrize('change', ['private_url', 'local_audio', 'traversal', 'too_many', 'duplicate'])
def test_reference_boundaries(change):
    value = copy.deepcopy(SETTINGS)
    if change == 'private_url': value['videos'][0]['url'] = 'https://127.0.0.1/private'
    if change == 'local_audio': value['audios'][0]['url'] = 'uploads/voice.wav'
    if change == 'traversal': value['videos'][0]['url'] = 'uploads/../private.mp4'
    if change == 'too_many': value['videos'] = [{'url': f'https://example.test/{i}.mp4'} for i in range(11)]
    if change == 'duplicate': value['videos'] *= 2
    with pytest.raises(ValidationError): OmniReferenceSettings.model_validate(value)


def test_saved_references_reach_task_and_provider_without_losing_images(api_client, monkeypatch, recorder, tmp_path):
    project_id, _, _ = setup_plan(api_client, monkeypatch)
    frame_id = 'old-frame'
    route = f'/projects/{project_id}'
    response = api_client.post(route + '/frames/update', json={'frame_id': frame_id, 'omni_reference_settings': SETTINGS})
    assert response.status_code == 200, response.text
    saved = api_client.get(route).json()['frames'][0]['omni_reference_settings']
    assert saved == SETTINGS
    script, task_id = api_module.pipeline.create_video_task(project_id, '', '只拍当前片段', duration=8,
        frame_id=frame_id, model='seedance-2.5-r2v', generation_mode='r2v',
        reference_image_urls=['https://example.test/character.png'], audio_mode='post')
    task = next(item for item in script.video_tasks if item.id == task_id)
    assert task.audio_mode == 'driven' and task.generate_audio
    assert task.reference_audio_urls == [item['url'] for item in SETTINGS['audios']]
    assert task.reference_video_urls == ['https://example.test/action.mp4']
    assert '只参考步伐和运镜' in task.prompt and '参考音频 2' in task.prompt
    model = JojoKeyVideoModel({})
    model.generate(task.prompt, str(tmp_path / 'result.mp4'), model=task.model, generation_mode=task.generation_mode,
        ref_image_urls=task.reference_image_urls, ref_video_urls=task.reference_video_urls,
        ref_audio_urls=task.reference_audio_urls, audio_url=task.audio_url, generate_audio=task.generate_audio)
    body = _submit_body(recorder)
    assert body['generate_audio'] is True and body['omni_reference_task_type'] == 'reference'
    assert [item.get('role') for item in body['content'][1:]] == ['reference_image', 'reference_video', 'reference_audio', 'reference_audio']
    assert len(body['content']) == 5  # The primary audio is not duplicated.
    assert Path(tmp_path / 'result.mp4').exists()
    rejected = api_client.post(route + '/frames/update', json={'frame_id': frame_id,
        'omni_reference_settings': {**SETTINGS, 'videos': [{'url': 'uploads/another-workspace/private.mp4'}]}})
    assert rejected.status_code == 404
    assert api_client.get(route).json()['frames'][0]['omni_reference_settings'] == SETTINGS
    current = api_module.pipeline.get_script(project_id)
    next(item for item in current.video_tasks if item.id == task.id).status = 'failed'
    api_module.pipeline._save_data()
    retry, created = api_module.pipeline.retry_video_task(project_id, task.id)
    assert created and retry.reference_audio_urls == task.reference_audio_urls
    assert retry.reference_video_urls == task.reference_video_urls and retry.prompt == task.prompt


def test_uploaded_video_can_be_saved_and_media_limits_are_checked_before_tasks(api_client, monkeypatch):
    project_id, _, _ = setup_plan(api_client, monkeypatch)
    upload = api_client.post('/upload', files={'file': ('action.mp4', b'owned-video', 'video/mp4')})
    assert upload.status_code == 200, upload.text
    settings = {'videos': [{'url': upload.json()['url'], 'purpose': '参考动作'}], 'audios': [], 'audio_mode': 'native'}
    route = f'/projects/{project_id}'
    saved = api_client.post(route + '/frames/update', json={'frame_id': 'old-frame', 'omni_reference_settings': settings})
    assert saved.status_code == 200, saved.text
    _, task_id = api_module.pipeline.create_video_task(project_id, '', '动作参考', frame_id='old-frame',
        model='seedance-2.5-r2v', generation_mode='r2v')
    task = next(t for t in api_module.pipeline.scripts[project_id].video_tasks if t.id == task_id)
    assert task.reference_image_urls == [] and task.reference_video_urls == [upload.json()['url']] and task.generate_audio
    with pytest.raises(ValueError, match='全能参考'):
        api_module.pipeline.create_video_task(project_id, '', 'not supported', frame_id='old-frame',
            model='wan2.7-r2v', generation_mode='r2v')
    with pytest.raises(ValueError, match='30'):
        api_module.pipeline.create_video_task(project_id, '', 'too many', frame_id='old-frame',
            model='seedance-2.5-r2v', generation_mode='r2v', reference_image_urls=['https://example.test/x.png'] * 31)


def test_reference_changes_require_new_plan_review_and_survive_reload(api_client, monkeypatch):
    project_id, _, _ = setup_plan(api_client, monkeypatch)
    script = api_module.pipeline.scripts[project_id]
    for person in script.characters:
        person.reference_sheet = AssetUnit(selected_image_id=person.id, image_variants=[ImageVariant(id=person.id, url=f'assets/{person.id}.png')])
    script.scenes[0].image_asset = ImageAsset(selected_id='scene', variants=[ImageVariant(id='scene', url='assets/scene.png')])
    api_module.pipeline._save_data()
    draft = generate(api_client, project_id)['production_plan_draft']
    route = f'/projects/{project_id}'
    api_client.post(route + '/production-plan/apply', json={'expected_revision': draft['revision']})
    script = api_module.pipeline.scripts[project_id]
    for frame in script.production_previews:
        frame.t2i_image_urls = [f'storyboard/{frame.id}.png']
    api_module.pipeline._save_data()
    frame_id = script.frames[0].id
    review = api_client.get(route + '/production-plan/review').json()['segments'][0]
    confirmed = api_client.post(route + f'/production-plan/segments/{frame_id}/confirm', json={'expected_fingerprint': review['fingerprint']})
    assert confirmed.status_code == 200
    updated = api_client.post(route + '/frames/update', json={'frame_id': frame_id, 'omni_reference_settings': SETTINGS})
    assert updated.status_code == 200
    next_review = api_client.get(route + '/production-plan/review').json()['segments'][0]
    assert next_review['can_confirm'] and next_review['changed_after_review'] and not next_review['ready']
    with pytest.raises(ValueError, match='确认'):
        api_module.pipeline.create_video_task(project_id, '', 'ignored', duration=8, frame_id=frame_id,
            model='seedance-2.5-r2v', generation_mode='r2v')
    api_client.post(route + f'/production-plan/segments/{frame_id}/confirm', json={'expected_fingerprint': next_review['fingerprint']})
    _, task_id = api_module.pipeline.create_video_task(project_id, '', 'ignored', duration=8, frame_id=frame_id,
        model='seedance-2.5-r2v', generation_mode='r2v')
    task = next(t for t in api_module.pipeline.scripts[project_id].video_tasks if t.id == task_id)
    assert len(task.reference_image_urls) == 5 and len(task.reference_video_urls) == 1 and len(task.reference_audio_urls) == 2
