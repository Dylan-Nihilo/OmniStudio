"""Production planning changes structure only after review and preserves previous work."""
import copy
import json
from contextlib import nullcontext
from types import SimpleNamespace

import pytest

from src.apps.comic_gen import api as api_module
from src.apps.comic_gen.models import Character, Scene, StoryboardFrame, VideoTask
from src.apps.comic_gen.production_planning import model_durations
from src.apps.comic_gen.llm_adapter import LLMAdapter
from tests.test_script_writing import configure_writer
from tests.test_w2_project_api import api_client, _create_project


def setup_plan(client, monkeypatch, title="制作计划"):
    project = _create_project(client, title)
    script = api_module.pipeline.scripts[project['id']]
    script.original_text = '陆青挡住亭口。沈砚停步。陆青问：“为何不答？”沈砚垂眼，仍不说话。'
    script.characters = [Character(id='lu', name='陆青', description='少年剑客'), Character(id='shen', name='沈砚', description='中年游侠')]
    script.scenes = [Scene(id='pavilion', name='雨夜破亭', description='破亭檐下')]
    script.frames = [StoryboardFrame(id='old-frame', scene_id='pavilion', action_description='原镜头', video_url='video/old.mp4', selected_video_id='old-task')]
    script.video_tasks = [VideoTask(id='old-task', project_id=script.id, frame_id='old-frame', image_url='', prompt='原提示词', status='completed', video_url='video/old.mp4')]
    api_module.pipeline._save_data()
    quotes = ['陆青挡住亭口。', '沈砚停步。', '为何不答？', '沈砚垂眼，仍不说话。']
    content = {'summary': '两段对峙，先拦路再反应。', 'continuity_rules': '陆青亭内看向右，沈砚檐下看向左；沈砚左手持鞘剑。', 'segments': []}
    for i in range(2):
        content['segments'].append({'title': f'片段{i+1}', 'scene_id': 'pavilion', 'purpose': '推进对峙',
            'start_state': '两人隔着亭口对视', 'end_state': '保持对视', 'connection': '延续雨声与视线' if i else '',
            'reference_names': ['陆青', '沈砚', '雨夜破亭'],
            'shots': [{'title': f'镜头{i*2+j+1}', 'description': quotes[i*2+j], 'camera': '固定机位中景',
                       'duration': 4, 'source_quote': quotes[i*2+j],
                       'dialogue': [{'speaker': '陆青', 'line': '为何不答？', 'mode': 'on_screen'}] if i*2+j == 2 else []}
                      for j in range(2)]})
    calls = configure_writer(client, monkeypatch, content)
    return project['id'], content, calls


def generate(client, project_id):
    response = client.post(f'/projects/{project_id}/production-plan/generate', json={
        'model': 'seedance-2.5-r2v', 'target_duration': 16, 'pacing': 'brisk'})
    assert response.status_code == 200, response.text
    return response.json()


def test_plan_review_apply_reload_and_restore_preserve_original_media(api_client, monkeypatch):
    project_id, content, calls = setup_plan(api_client, monkeypatch)
    route = f'/projects/{project_id}/production-plan'
    drafted = generate(api_client, project_id)
    assert drafted['frames'][0]['id'] == 'old-frame'
    assert drafted['production_plan'] is None
    draft = drafted['production_plan_draft']
    assert len(draft['segments']) == 2
    assert sum(len(segment['shots']) for segment in draft['segments']) == 4
    assert 30 in calls[0]['allowed_segment_durations']
    assert calls[0]['settings']['target_duration'] == 16
    assert api_client.get(route).json()['draft']['id'] == draft['id']
    edit = {k: draft[k] for k in ('summary', 'continuity_rules', 'segments')}
    edit['summary'] = '人工确认后的节奏'
    edit['expected_revision'] = draft['revision']
    edited = api_client.put(route, json=edit)
    assert edited.status_code == 200, edited.text
    draft = edited.json()['production_plan_draft']
    assert api_client.put(route, json=edit).status_code == 409
    applied = api_client.post(route + '/apply', json={'expected_revision': draft['revision']})
    assert applied.status_code == 200, applied.text
    active = applied.json()
    assert len(active['frames']) == 2 and len(active['production_previews']) == 4
    assert '本片段开场状态' in active['production_previews'][0]['image_prompt']
    assert '前一镜叙事' in active['production_previews'][1]['image_prompt']
    assert '本片段开场状态' not in active['production_previews'][1]['image_prompt']
    assert active['production_plan']['status'] == 'approved'
    assert [f['duration'] for f in active['frames']] == [8, 8]
    assert '镜头2' in active['frames'][0]['visual_description']
    assert '为何不答？' in active['frames'][1]['visual_description']
    assert active['frames'][0]['model_settings_overrides']['r2v_model'] == 'seedance-2.5-r2v'
    assert active['video_tasks'][0]['video_url'] == 'video/old.mp4'
    assert active['storyboard_versions'][0]['frames'][0]['selected_video_id'] == 'old-task'
    repeated = api_client.post(route + '/apply', json={'expected_revision': draft['revision']})
    assert repeated.status_code == 200 and len(repeated.json()['storyboard_versions']) == 1
    overview = api_client.get(route).json()
    restored = api_client.post(route + '/versions/' + overview['versions'][0]['id'] + '/restore',
        json={'expected_fingerprint': overview['storyboard_fingerprint']})
    assert restored.status_code == 200, restored.text
    assert restored.json()['frames'][0]['video_url'] == 'video/old.mp4'
    assert restored.json()['production_plan'] is None
    assert len(restored.json()['storyboard_versions']) == 2
    api_module.pipeline.video_generator.generate_video.assert_not_called()
    api_module.pipeline.storyboard_generator.generate_frame.assert_not_called()


@pytest.mark.parametrize('changed', ['script', 'frame'])
def test_old_plan_cannot_overwrite_new_creative_changes(api_client, monkeypatch, changed):
    project_id, _, _ = setup_plan(api_client, monkeypatch)
    draft = generate(api_client, project_id)['production_plan_draft']
    script = api_module.pipeline.scripts[project_id]
    if changed == 'script': script.original_text += '新的结尾。'
    else: script.frames[0].visual_description = '用户刚改的新提示词'
    api_module.pipeline._save_data()
    response = api_client.post(f'/projects/{project_id}/production-plan/apply', json={'expected_revision': draft['revision']})
    assert response.status_code == 409
    saved = api_client.get('/projects/' + project_id).json()
    assert saved['frames'][0]['id'] == 'old-frame'
    assert saved['storyboard_versions'] == []


@pytest.mark.parametrize('invalid', ['duration', 'scene', 'quote', 'dialogue', 'reference', 'reference_limit'])
def test_invalid_model_proposals_never_replace_project(api_client, monkeypatch, invalid):
    project_id, content, _ = setup_plan(api_client, monkeypatch)
    bad = copy.deepcopy(content)
    segment = bad['segments'][0]
    if invalid == 'duration': segment['shots'][0]['duration'] = 30
    if invalid == 'scene': segment['scene_id'] = 'invented'
    if invalid == 'quote': segment['shots'][0]['source_quote'] = '不在剧本里的证据'
    if invalid == 'dialogue': segment['shots'][0]['dialogue'] = [{'speaker': '陆青', 'line': '杜撰的台词'}]
    if invalid == 'reference': segment['reference_names'].append('不存在的角色')
    if invalid == 'reference_limit': segment['shots'] = [{**copy.deepcopy(segment['shots'][0]), 'duration': 1} for _ in range(28)]
    configure_writer(api_client, monkeypatch, bad)
    response = api_client.post(f'/projects/{project_id}/production-plan/generate', json={'model': 'seedance-2.5-r2v'})
    assert response.status_code == 502, response.text
    saved = api_client.get('/projects/' + project_id).json()
    assert saved['production_plan_draft'] is None
    assert saved['production_planning_job']['status'] == 'failed'
    assert saved['frames'][0]['video_url'] == 'video/old.mp4'


def test_edit_checks_duration_and_running_video_blocks_plan_application(api_client, monkeypatch):
    project_id, _, _ = setup_plan(api_client, monkeypatch)
    draft = generate(api_client, project_id)['production_plan_draft']
    edit = {k: draft[k] for k in ('summary', 'continuity_rules', 'segments')}
    edit['expected_revision'] = draft['revision']
    edit['segments'][0]['shots'][0]['duration'] = 30
    route = f'/projects/{project_id}/production-plan'
    assert api_client.put(route, json=edit).status_code == 422
    script = api_module.pipeline.scripts[project_id]
    script.video_tasks[0].status = 'processing'
    api_module.pipeline._save_data()
    assert api_client.post(route + '/apply', json={'expected_revision': draft['revision']}).status_code == 409
    assert api_client.get(route).json()['draft']['revision'] == draft['revision']


def test_unknown_project_and_wrong_model_are_rejected(api_client, monkeypatch):
    project_id, _, calls = setup_plan(api_client, monkeypatch)
    assert api_client.get('/projects/unknown/production-plan').status_code == 404
    assert api_client.post(f'/projects/{project_id}/production-plan/generate', json={'model': 'unregistered-model'}).status_code == 422
    assert calls == []
    assert model_durations('seedance-2.5-r2v') == list(range(4, 31))


def test_previs_review_is_required_and_includes_images_in_video_inputs(api_client, monkeypatch):
    from src.apps.comic_gen.models import AssetUnit, ImageAsset, ImageVariant, GenerationStatus
    from src.apps.comic_gen.production_planning import reviewed_video_inputs
    project_id, _, _ = setup_plan(api_client, monkeypatch)
    script = api_module.pipeline.scripts[project_id]
    for person in script.characters:
        person.reference_sheet = AssetUnit(selected_image_id=person.id, image_variants=[ImageVariant(id=person.id, url=f'assets/{person.id}.png')])
    script.scenes[0].image_asset = ImageAsset(selected_id='scene', variants=[ImageVariant(id='scene', url='assets/scene.png')])
    api_module.pipeline._save_data()
    draft = generate(api_client, project_id)['production_plan_draft']
    base = f'/projects/{project_id}'
    plan_route = base + '/production-plan'
    applied = api_client.post(plan_route + '/apply', json={'expected_revision': draft['revision']}).json()
    frame_id = applied['frames'][0]['id']
    review = api_client.get(plan_route + '/review').json()['segments'][0]
    assert not review['can_confirm']
    with pytest.raises(ValueError, match='确认'):
        api_module.pipeline.create_video_task(project_id, '', 'submitted text', duration=8, model='seedance-2.5-r2v', frame_id=frame_id, generation_mode='r2v', audio_mode='post')
    assert api_client.post(plan_route + f'/segments/{frame_id}/confirm', json={'expected_fingerprint': review['fingerprint']}).status_code == 422
    def render(frame, *args, **kwargs):
        frame.rendered_image_asset = ImageAsset(selected_id=frame.id, variants=[ImageVariant(id=frame.id, url=f'storyboard/{frame.id}.png')])
        frame.status = GenerationStatus.COMPLETED
    api_module.pipeline.storyboard_generator.generate_frame.side_effect = render
    for preview in applied['production_previews']:
        response = api_client.post(base + '/storyboard/render', json={'frame_id': preview['id'], 'prompt': preview['image_prompt'],
            'composition_data': {'reference_image_urls': ['assets/lu.png', 'assets/shen.png', 'assets/scene.png']}})
        assert response.status_code == 200, response.text
    review = api_client.get(plan_route + '/review').json()['segments'][0]
    assert review['can_confirm'] and not review['ready']
    confirmed = api_client.post(plan_route + f'/segments/{frame_id}/confirm', json={'expected_fingerprint': review['fingerprint']})
    assert confirmed.status_code == 200, confirmed.text
    assert api_client.get(plan_route + '/review').json()['segments'][0]['ready']
    script = api_module.pipeline.scripts[project_id]
    prompt, refs = reviewed_video_inputs(script, script.frames[0], api_module.pipeline.resolve_episode_assets(script), 'seedance-2.5-r2v', 8)
    assert refs == ['assets/lu.png', 'assets/shen.png', 'assets/scene.png', *review['preview_urls']]
    assert '参考图 4 对应本片段镜头 1' in prompt and '[character' not in prompt
    _, task_id = api_module.pipeline.create_video_task(project_id, '', 'submitted text', duration=8, model='seedance-2.5-r2v', frame_id=frame_id, generation_mode='r2v', audio_mode='post')
    submitted = next(t for t in api_module.pipeline.scripts[project_id].video_tasks if t.id == task_id)
    assert submitted.reference_image_urls == refs and submitted.prompt == prompt
    script = api_module.pipeline.scripts[project_id]
    script.frames[0].duration = 12
    api_module.pipeline._save_data()
    timing_review = api_client.get(plan_route + '/review').json()['segments'][0]
    assert not timing_review['can_confirm']
    assert any('时长与镜头安排不一致' in item for item in timing_review['blockers'])
    script = api_module.pipeline.scripts[project_id]
    script.frames[0].duration = 8
    api_module.pipeline._save_data()
    # Uploading and selecting a preview uses the real protected image routes.
    import base64
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII=')
    preview_id = applied['production_previews'][0]['id']
    upload = api_client.post(base + f'/frames/{preview_id}/upload_t2i', files={'file': ('replacement.png', png, 'image/png')})
    assert upload.status_code == 200, upload.text
    assert len(upload.json()['t2i_image_urls']) == 2
    assert not api_client.get(plan_route + '/review').json()['segments'][0]['ready']
    choose = api_client.patch(plan_route + f'/previews/{preview_id}', json={'selected_index': 0})
    assert choose.status_code == 200, choose.text
    assert api_client.get(plan_route + '/review').json()['segments'][0]['ready']
    # Review of the next segment becomes stale when the preceding take changes.
    next_report = api_client.get(plan_route + '/review').json()['segments'][1]
    assert api_client.post(plan_route + f"/segments/{script.frames[1].id}/confirm", json={'expected_fingerprint': next_report['fingerprint']}).status_code == 200
    script = api_module.pipeline.scripts[project_id]
    script.frames[0].selected_video_id = 'new-take'
    script.frames[0].video_url = 'video/new-take.mp4'
    api_module.pipeline._save_data()
    current = api_client.get(plan_route + '/review').json()['segments'][1]
    assert current['can_confirm'] and not current['ready']
    assert current['previous_video_url'] == 'video/new-take.mp4'
    assert api_client.post(plan_route + f"/segments/{script.frames[1].id}/confirm", json={'expected_fingerprint': next_report['fingerprint']}).status_code == 409
    with pytest.raises(ValueError, match='确认'):
        reviewed_video_inputs(script, script.frames[1], api_module.pipeline.resolve_episode_assets(script), 'seedance-2.5-r2v', 8)


def test_confirmed_plan_can_be_revised_without_touching_current_frames(api_client, monkeypatch):
    project_id, _, _ = setup_plan(api_client, monkeypatch)
    draft = generate(api_client, project_id)['production_plan_draft']
    route = f'/projects/{project_id}/production-plan'
    active = api_client.post(route + '/apply', json={'expected_revision': draft['revision']}).json()
    revised = api_client.post(route + '/revise')
    assert revised.status_code == 200, revised.text
    revised = revised.json()
    assert revised['frames'] == active['frames']
    assert revised['production_plan_draft']['id'] != active['production_plan']['id']
    assert revised['production_plan_draft']['status'] == 'draft'
    old_ids = {shot['id'] for segment in active['production_plan']['segments'] for shot in segment['shots']}
    new_ids = {shot['id'] for segment in revised['production_plan_draft']['segments'] for shot in segment['shots']}
    assert old_ids.isdisjoint(new_ids)
    repeated = api_client.post(route + '/revise').json()
    assert repeated['production_plan_draft']['revision'] == revised['production_plan_draft']['revision']


def test_slow_planning_does_not_overwrite_an_edited_draft(api_client, monkeypatch):
    from src.apps.comic_gen.llm_adapter import LLMAdapter
    project_id, content, _ = setup_plan(api_client, monkeypatch)
    generate(api_client, project_id)
    def concurrent_edit(*args, **kwargs):
        script = api_module.pipeline.scripts[project_id]
        script.production_plan_draft.summary = '用户刚保存的安排'
        script.production_plan_draft.revision = 'newer-user-revision'
        api_module.pipeline._save_data()
        return json.dumps(content, ensure_ascii=False)
    monkeypatch.setattr(LLMAdapter, 'chat', concurrent_edit)
    response = api_client.post(f'/projects/{project_id}/production-plan/generate', json={'model': 'seedance-2.5-r2v'})
    assert response.status_code == 409
    assert api_client.get(f'/projects/{project_id}/production-plan').json()['draft']['summary'] == '用户刚保存的安排'


@pytest.mark.parametrize('change_rules', [False, True])
def test_revised_plan_retains_media_only_for_unchanged_segments(api_client, monkeypatch, change_rules):
    from src.apps.comic_gen.omni_reference import OmniReferenceSettings
    project_id, _, _ = setup_plan(api_client, monkeypatch)
    route = f'/projects/{project_id}/production-plan'
    draft = generate(api_client, project_id)['production_plan_draft']
    assert api_client.post(route + '/apply', json={'expected_revision': draft['revision']}).status_code == 200
    script = api_module.pipeline.scripts[project_id]
    for index, frame in enumerate(script.frames):
        frame.video_url = f'video/segment-{index}.mp4'
        frame.omni_reference_settings = OmniReferenceSettings(audio_mode='native')
    for index, preview in enumerate(script.production_previews):
        preview.t2i_image_urls = [f'storyboard/image-{index}.png']
        preview.t2i_selected_index = 0
        preview.image_generation_status = 'completed'
    api_module.pipeline._save_data()
    before = api_client.get('/projects/' + project_id).json()
    draft = api_client.post(route + '/revise').json()['production_plan_draft']
    draft['segments'][0]['shots'][0]['description'] = '低机位踩水挡路'
    if change_rules:
        draft['continuity_rules'] += '改为晴天。'
    edit = {key: draft[key] for key in ('summary', 'continuity_rules', 'segments')}
    edit['expected_revision'] = draft['revision']
    saved = api_client.put(route, json=edit)
    assert saved.status_code == 200, saved.text
    result = api_client.post(route + '/apply', json={'expected_revision': saved.json()['production_plan_draft']['revision']})
    assert result.status_code == 200, result.text
    after = result.json()
    assert after['frames'][0]['id'] != before['frames'][0]['id']
    assert not after['frames'][0]['video_url']
    assert after['storyboard_versions'][-1]['frames'] == before['frames']
    assert after['storyboard_versions'][-1]['production_previews'] == before['production_previews']
    if change_rules:
        assert after['frames'][1]['id'] != before['frames'][1]['id']
        assert not any(p['t2i_image_urls'] for p in after['production_previews'])
    else:
        assert after['frames'][1] == {**before['frames'][1], 'production_plan_id': after['production_plan']['id']}
        assert after['production_previews'][2:] == [
            {**p, 'production_plan_id': after['production_plan']['id']} for p in before['production_previews'][2:]]
        assert not any(p['t2i_image_urls'] for p in after['production_previews'][:2])
        assert api_client.get(route + '/review').status_code == 200
