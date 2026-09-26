"""Production planning changes structure only after review and preserves previous work."""
import copy
import json
from contextlib import nullcontext
from types import SimpleNamespace

import pytest

from src.apps.comic_gen import api as api_module
from src.apps.comic_gen.models import Character, Scene, StoryboardFrame, VideoTask, GenerationStatus
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


def test_planning_requires_a_scene_before_contacting_the_model(api_client, monkeypatch):
    project_id, _, calls = setup_plan(api_client, monkeypatch)
    api_module.pipeline.scripts[project_id].scenes = []
    response = api_client.post(f'/projects/{project_id}/production-plan/generate', json={
        'model': 'seedance-2.5-r2v', 'target_duration': 16, 'pacing': 'brisk'})
    assert response.status_code == 422
    assert '场景' in response.json()['detail']
    assert calls == []


@pytest.mark.parametrize('base_url', ['https://kaizo.top/v1', 'https://api.example.test/v1', 'https://kaizo.top.example.test/v1'])
def test_planning_requests_isolate_kaizo_cache_without_changing_content(api_client, monkeypatch, base_url):
    real_chat = LLMAdapter.chat
    project_id, content, _ = setup_plan(api_client, monkeypatch)
    monkeypatch.setattr(LLMAdapter, 'chat', real_chat)
    assert api_client.post('/config/env', json={'OPENAI_BASE_URL': base_url}).status_code == 200
    sent = []

    def create(**kwargs):
        key = kwargs.get('prompt_cache_key')
        if base_url == 'https://kaizo.top/v1':
            if not key or any(previous['prompt_cache_key'] == key for previous in sent):
                raise RuntimeError('Our servers are currently overloaded. Please try again later.')
        else:
            assert 'prompt_cache_key' not in kwargs
        sent.append(kwargs)
        return nullcontext(iter([SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(content=json.dumps(content, ensure_ascii=False)), finish_reason='stop'
        )])]))

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(LLMAdapter, '_get_client', lambda self, model=None: client)
    first = generate(api_client, project_id)
    second = generate(api_client, project_id)
    assert first['production_planning_job']['id'] != second['production_planning_job']['id']
    assert first['frames'] == second['frames']
    assert len(sent) == 2
    assert {k: v for k, v in sent[0].items() if k != 'prompt_cache_key'} == {
        k: v for k, v in sent[1].items() if k != 'prompt_cache_key'
    }
    assert json.loads(sent[0]['messages'][1]['content'])['existing_shots'][0]['has_video'] is True


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


def test_production_preview_candidate_removal_reselects_and_clears_without_deleting_source_media(api_client, monkeypatch, tmp_path):
    from src.apps.comic_gen.models import ImageAsset, ImageVariant
    source = tmp_path / 'storyboard' / 'b.png'
    source.parent.mkdir()
    source.write_bytes(b'original-media')
    project_id, _, _ = setup_plan(api_client, monkeypatch)
    draft = generate(api_client, project_id)['production_plan_draft']
    route = f'/projects/{project_id}/production-plan'
    applied = api_client.post(route + '/apply', json={'expected_revision': draft['revision']}).json()
    preview_id = applied['production_previews'][0]['id']
    script = api_module.pipeline.scripts[project_id]
    preview = next(item for item in script.production_previews if item.id == preview_id)
    preview.t2i_image_urls = ['storyboard/a.png', 'storyboard/b.png', 'storyboard/c.png']
    preview.t2i_selected_index = 1
    preview.rendered_image_url = 'storyboard/b.png'
    preview.rendered_image_asset = ImageAsset(selected_id='b', variants=[ImageVariant(id=name, url=f'storyboard/{name}.png') for name in ['a', 'b', 'c']])
    api_module.pipeline._save_data()
    current = api_client.get(f'/projects/{project_id}').json()
    removed = api_client.delete(
        route + f'/previews/{preview_id}/candidates/1',
        params={'expected_revision': current['_revision']},
    )
    assert removed.status_code == 200, removed.text
    result = next(item for item in removed.json()['production_previews'] if item['id'] == preview_id)
    assert result['t2i_image_urls'] == ['storyboard/a.png', 'storyboard/c.png']
    assert result['t2i_selected_index'] == 1
    assert result['rendered_image_url'] == 'storyboard/c.png'
    assert [v['id'] for v in result['rendered_image_asset']['variants']] == ['a', 'c']
    assert result['rendered_image_asset']['selected_id'] == 'c'
    assert removed.json()['_revision'] != current['_revision']
    stale = api_client.delete(
        route + f'/previews/{preview_id}/candidates/0',
        params={'expected_revision': current['_revision']},
    )
    assert stale.status_code == 409, stale.text
    latest = api_client.get(f'/projects/{project_id}').json()
    cleared = api_client.delete(
        route + f'/previews/{preview_id}/candidates',
        params={'expected_revision': removed.json()['_revision']},
    )
    assert cleared.status_code == 200, cleared.text
    result = next(item for item in cleared.json()['production_previews'] if item['id'] == preview_id)
    assert result['t2i_image_urls'] == []
    assert result['t2i_selected_index'] == 0
    assert result.get('rendered_image_url') is None
    assert result.get('image_url') is None
    assert result.get('rendered_image_asset') is None
    reloaded = api_client.get(f'/projects/{project_id}').json()
    assert reloaded['production_previews'][0] == result
    assert reloaded['video_tasks'][0]['video_url'] == 'video/old.mp4'
    assert reloaded['storyboard_versions'][0]['frames'][0]['video_url'] == 'video/old.mp4'
    assert source.read_bytes() == b'original-media'


def test_production_preview_candidate_removal_rejects_generation_and_invalid_index(api_client, monkeypatch):
    project_id, _, _ = setup_plan(api_client, monkeypatch)
    draft = generate(api_client, project_id)['production_plan_draft']
    route = f'/projects/{project_id}/production-plan'
    applied = api_client.post(route + '/apply', json={'expected_revision': draft['revision']}).json()
    preview_id = applied['production_previews'][0]['id']
    script = api_module.pipeline.scripts[project_id]
    preview = next(item for item in script.production_previews if item.id == preview_id)
    preview.t2i_image_urls = ['storyboard/a.png']
    preview.image_generation_status = GenerationStatus.PROCESSING
    api_module.pipeline._save_data()
    current = api_client.get(f'/projects/{project_id}').json()
    busy = api_client.delete(route + f'/previews/{preview_id}/candidates/0', params={'expected_revision': current['_revision']})
    assert busy.status_code == 409, busy.text
    preview = next(item for item in api_module.pipeline.scripts[project_id].production_previews if item.id == preview_id)
    preview.image_generation_status = GenerationStatus.COMPLETED
    api_module.pipeline._save_data()
    current = api_client.get(f'/projects/{project_id}').json()
    invalid = api_client.delete(route + f'/previews/{preview_id}/candidates/3', params={'expected_revision': current['_revision']})
    assert invalid.status_code == 422, invalid.text


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
def test_a_flawed_proposal_is_kept_for_editing_but_never_reaches_production(api_client, monkeypatch, invalid):
    """Deliberate reversal of how this used to work.

    A proposal that broke one rule used to be thrown away: the request failed, no draft was
    stored, and the only advice was to generate again — which hit the same rule again. There
    was nothing to correct, and the fields that failed were not even editable, so a user
    could get permanently stuck on one bad segment.

    The invariant that mattered is unchanged and still asserted below: a flawed plan must
    not replace the approved plan, the frames or the rendered video. It simply arrives as a
    draft carrying its problems, and approval is where the refusal now happens.
    """
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
    assert response.status_code == 200, response.text

    saved = api_client.get('/projects/' + project_id).json()
    draft = saved['production_plan_draft']
    assert draft is not None, 'the draft has to survive so it can be corrected'
    problems = draft['problems']
    assert problems, 'and it has to say what is wrong'
    assert all(p['segment_index'] == 1 for p in problems), problems
    # Enough to locate the offending input in the editor.
    assert all(p['field'] for p in problems) and all(p['message'] for p in problems)

    # Nothing about production moved.
    assert saved['frames'][0]['video_url'] == 'video/old.mp4'
    refused = api_client.post(f'/projects/{project_id}/production-plan/apply',
                              json={'expected_revision': draft['revision']})
    assert refused.status_code == 422, refused.text
    assert '未解决的问题' in str(refused.json()['detail'])


def test_a_partial_fix_can_be_saved_and_running_video_blocks_plan_application(api_client, monkeypatch):
    """Editing records problems rather than refusing the save.

    Also a reversal: an edit that still broke a rule was rejected outright, so someone
    working through three problems could not save after fixing the first one.
    """
    project_id, _, _ = setup_plan(api_client, monkeypatch)
    draft = generate(api_client, project_id)['production_plan_draft']
    edit = {k: draft[k] for k in ('summary', 'continuity_rules', 'segments')}
    edit['expected_revision'] = draft['revision']
    edit['segments'][0]['shots'][0]['duration'] = 30
    route = f'/projects/{project_id}/production-plan'
    saved_edit = api_client.put(route, json=edit)
    assert saved_edit.status_code == 200, saved_edit.text
    stored = saved_edit.json()['production_plan_draft']
    assert [p['field'] for p in stored['problems']] == ['duration']
    # ...but it cannot be applied while that problem stands.
    assert api_client.post(route + '/apply', json={'expected_revision': stored['revision']}).status_code == 422
    draft = stored
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
    assert any(item['code'] == 'DURATION_MISMATCH' for item in timing_review['blockers'])
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


# --- quoting the script ---------------------------------------------------------------
# From a real episode (潮骨·第1集): two of three generated plans were rejected purely
# because the planner quoted across a blank line, and the message blamed the script for
# having changed. The third was a genuine elision and should still be refused.

SCRIPT_EXTRACT = (
    "观测站的地面裂开一条细缝，蓝色潮光从缝里涌出。沈砚秋把潜水灯照向墙面，"
    "七道波纹标记在墙上逐一亮起。\n\n"
    "沈砚秋：如果你要问为什么是你，先活过这扇门。\n\n"
    "地下传来第二声回响，闸门上的水珠同时向上浮起。"
)


def test_a_quote_that_spans_a_blank_line_is_still_the_script():
    """A script is written in paragraphs and the planner quotes straight through them. Word
    for word this is the script; only the blank line is missing."""
    from src.apps.comic_gen.production_planning import quotes_the_script

    spans_paragraphs = ("七道波纹标记在墙上逐一亮起。"
                        "沈砚秋：如果你要问为什么是你，先活过这扇门。")
    assert spans_paragraphs not in SCRIPT_EXTRACT, "a plain substring test rejects it"
    assert quotes_the_script(spans_paragraphs, SCRIPT_EXTRACT)


def test_a_quote_that_skips_a_sentence_is_refused():
    """The case worth catching: the planner jumped from a stage direction to a line four
    sentences later. Accepting that would let the plan drift from the script it cites."""
    from src.apps.comic_gen.production_planning import quotes_the_script

    elided = ("观测站的地面裂开一条细缝，蓝色潮光从缝里涌出。"
              "沈砚秋：如果你要问为什么是你，先活过这扇门。")
    assert not quotes_the_script(elided, SCRIPT_EXTRACT)


def test_invented_dialogue_is_still_refused():
    from src.apps.comic_gen.production_planning import quotes_the_script

    assert not quotes_the_script("沈砚秋：我从来没说过这句话。", SCRIPT_EXTRACT)


def test_a_problem_quotes_the_offending_text_in_full():
    """The message used to truncate the quote at 40 characters, and the part that was wrong
    was usually past that point: a user looked at a prefix that was perfectly valid script
    and could not see what the complaint was about. Reported from production on 斗破苍穹.
    """
    from src.apps.comic_gen.production_planning import (
        PlanContent, PlanSettings, collect_problems,
    )

    tail = "结尾一句，" + "很长" * 30 + "。"
    script_text = f"开头一句。\n\n中间被跳过的一句。\n\n{tail}"
    long_quote = f"开头一句。{tail}"
    assert len(long_quote) > 40, "the point only holds for a quote past the old cutoff"

    content = PlanContent.model_validate({
        "summary": "一段", "continuity_rules": "无",
        "segments": [{
            "id": "seg-1", "title": "片段一", "scene_id": "scene-1", "purpose": "推进",
            "start_state": "开场", "end_state": "结尾", "reference_names": ["场景"],
            "shots": [{"id": "shot-1", "title": "镜头一", "description": "画面",
                       "camera": "中景", "duration": 4, "source_quote": long_quote,
                       "dialogue": []}],
        }],
    })

    class _Scene:
        id, name, description = "scene-1", "场景", ""
        image_asset = None

    class _Script:
        original_text = script_text

    assets = {"characters": [], "scenes": [_Scene()], "props": []}
    problems, _ = collect_problems(content, PlanSettings(model="seedance-2.5-r2v"), _Script(), assets)
    quote_problems = [p for p in problems if p.field == "source_quote"]
    assert quote_problems, problems
    assert long_quote in quote_problems[0].message, "the whole quote has to be shown"


def test_a_blocker_names_the_numbers_and_where_the_setting_lives(api_client, monkeypatch):
    """"请调整时长或拆分" did not say which model, what it allows, or where the setting is.

    Reported from production: 斗破苍穹 片段2 was 25s while quietly switched to a model that
    caps at 15s — every other segment was on the 30s model. Nothing on screen mentioned the
    per-segment override, so there was no way to know what to change.
    """
    from src.apps.comic_gen.production_planning import model_durations, segment_review

    project_id, _, _ = setup_plan(api_client, monkeypatch)
    draft = generate(api_client, project_id)['production_plan_draft']
    api_client.post(f'/projects/{project_id}/production-plan/apply',
                    json={'expected_revision': draft['revision']})
    script = api_module.pipeline.scripts[project_id]
    plan_max = max(model_durations(script.production_plan.settings.model))
    short_model = 'seedance-2.0-r2v'
    short_max = max(model_durations(short_model))
    assert short_max < plan_max, "the point needs a model with less capacity than the plan's"

    frame, segment = script.frames[0], script.production_plan.segments[0]
    frame.model_settings_overrides = {'r2v_model': short_model}
    # A segment's duration is the sum of its shots (a computed property), so the shots are
    # what set it. Chosen to keep 26 / 15 / 30 distinct, which is what makes the assertion
    # below mean something — and it mirrors the reported case.
    for shot in segment.shots:
        shot.duration = 13
    frame.duration = segment.duration
    assert frame.duration == 26 and frame.duration > short_max
    api_module.pipeline._save_data()

    blockers = {item['code']: item for item in
                segment_review(script, frame, api_module.pipeline.resolve_episode_assets(script))['blockers']}
    duration = blockers['DURATION_UNSUPPORTED']
    assert duration['fix'] == 'segment_model', "the UI needs to know the setting is per-segment"
    # Every number a person needs in order to decide: how long the segment is, what this
    # model takes, and what the plan's own model would take.
    for number in (frame.duration, short_max, plan_max):
        assert str(number) in duration['message'], duration['message']
    assert duration['is_override'] is True

    # A mismatch between the segment and its shots names both figures rather than neither.
    frame.duration = short_max
    api_module.pipeline._save_data()
    mismatch = next(item for item in segment_review(
        script, frame, api_module.pipeline.resolve_episode_assets(script))['blockers']
        if item['code'] == 'DURATION_MISMATCH')
    assert mismatch['fix'] == 'plan_timing'
    assert str(short_max) in mismatch['message'] and str(segment.duration) in mismatch['message']


def test_a_shot_waits_only_on_its_own_segment_so_segments_can_render_at_once(api_client, monkeypatch):
    """Storyboard images used to be one strictly serial queue for a whole episode.

    Each shot carried the *previous* shot's rendered image as an I2I reference and refused
    to start until it existed, and the chain only broke when the scene changed — so an
    episode shot in a single scene (斗破苍穹: 19 shots, one scene) could not render anything
    in parallel. The chain now stops at the segment boundary: a segment is one video
    generation with a cut on either side, and its first shot carries the opening state as
    text instead. Continuity inside a segment is unchanged.
    """
    from src.apps.comic_gen.models import AssetUnit, ImageAsset, ImageVariant
    from src.apps.comic_gen.production_planning import production_preview_inputs

    project_id, _, _ = setup_plan(api_client, monkeypatch)
    script = api_module.pipeline.scripts[project_id]
    for person in script.characters:
        person.reference_sheet = AssetUnit(selected_image_id=person.id,
                                           image_variants=[ImageVariant(id=person.id, url=f'assets/{person.id}.png')])
    script.scenes[0].image_asset = ImageAsset(selected_id='scene', variants=[ImageVariant(id='scene', url='assets/scene.png')])
    api_module.pipeline._save_data()
    draft = generate(api_client, project_id)['production_plan_draft']
    api_client.post(f'/projects/{project_id}/production-plan/apply', json={'expected_revision': draft['revision']})
    script = api_module.pipeline.scripts[project_id]
    assets = api_module.pipeline.resolve_episode_assets(script)
    first_of_one, second_of_one, first_of_two, _ = script.production_previews
    assert first_of_one.scene_id == first_of_two.scene_id, "the same scene is what used to chain them"

    def inputs(preview):
        return production_preview_inputs(script, preview, preview.image_prompt, assets)

    # Nothing rendered yet: the opening shot of *either* segment can start right now.
    for preview in (first_of_one, first_of_two):
        prompt, _ = inputs(preview)
        assert '上一镜' not in prompt

    # A later shot in a segment still waits for the one before it — that dependency is real.
    with pytest.raises(ValueError, match='请先完成上一张分镜图'):
        inputs(second_of_one)

    first_of_one.t2i_image_urls = ['storyboard/first.png']
    first_of_one.image_generation_status = GenerationStatus.COMPLETED
    api_module.pipeline._save_data()

    prompt, composition = inputs(second_of_one)
    assert '上一镜' in prompt
    assert 'storyboard/first.png' in composition['reference_image_urls']

    # ...but the next segment never picks it up, however far along segment one is.
    _, across = inputs(first_of_two)
    assert 'storyboard/first.png' not in across['reference_image_urls']


def _stream_headers(client) -> dict:
    """`stream()` bypasses the wrapper that normally attaches these."""
    return {"Origin": "http://testserver",
            "X-CSRF-Token": client.cookies.get("omni_studio_csrf") or ""}


def test_generation_reports_progress_as_it_drafts(api_client, monkeypatch):
    """The planner is one long model call, so the only honest progress comes from the
    stream. Without it a user watches a spinner for a minute or two with no idea whether
    anything is happening or which part is being worked on."""
    project_id, content, _ = setup_plan(api_client, monkeypatch)
    configure_writer(api_client, monkeypatch, content)

    with api_client.stream("POST", f"/projects/{project_id}/production-plan/generate/stream",
                           json={"model": "seedance-2.5-r2v"},
                           headers=_stream_headers(api_client)) as response:
        assert response.status_code == 200
        events = []
        event_type = None
        for line in response.iter_lines():
            line = line.rstrip("\r")
            if line.startswith("event:"):
                event_type = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                events.append((event_type, json.loads(line.split(":", 1)[1].strip())))

    kinds = [kind for kind, _ in events]
    assert kinds[-1] == "plan_complete", kinds
    completion = events[-1][1]
    assert completion["segments"] == len(content["segments"])

    progress = [payload for kind, payload in events if kind == "plan_progress"]
    assert progress, "the stream has to say something before it finishes"
    counts = [item["segments"] for item in progress]
    assert counts == sorted(counts), f"progress must not go backwards: {counts}"
    assert counts[-1] == len(content["segments"])


def test_a_failed_generation_is_reported_through_the_stream(api_client, monkeypatch):
    """A stream that simply closes leaves the client unable to tell success from failure."""
    project_id, _, _ = setup_plan(api_client, monkeypatch)

    def explode(*args, **kwargs):
        raise RuntimeError("provider exploded at https://relay.example/v1 using gpt-image-2")

    monkeypatch.setattr(api_module.pipeline, "generate_production_plan", explode)
    with api_client.stream("POST", f"/projects/{project_id}/production-plan/generate/stream",
                           json={"model": "seedance-2.5-r2v"},
                           headers=_stream_headers(api_client)) as response:
        body = "\n".join(response.iter_lines())

    assert "plan_failed" in body
    # Same rule as everywhere else: a user-facing failure names no vendor and no endpoint.
    assert "relay.example" not in body and "gpt-image-2" not in body


def test_applying_a_plan_carries_its_dialogue_into_the_dubbing_workbench(api_client, monkeypatch):
    """The plan holds every line already; applying it used to throw them away.

    Reported from production on 斗破苍穹: the dubbing workbench opened with an empty text
    box on all eight segments, so lines the planner had already lifted from the script — and
    checked against it word for word — had to be typed again by hand.
    """
    project_id, content, _ = setup_plan(api_client, monkeypatch)
    draft = generate(api_client, project_id)['production_plan_draft']
    applied = api_client.post(f'/projects/{project_id}/production-plan/apply',
                              json={'expected_revision': draft['revision']})
    assert applied.status_code == 200, applied.text
    script = api_module.pipeline.scripts[project_id]

    # The fixture puts one line, spoken by 陆青, in the second segment's first shot.
    spoken = next(frame for frame, segment in zip(script.frames, script.production_plan.segments)
                  if any(shot.dialogue for shot in segment.shots))
    assert spoken.dialogue == '为何不答？'
    assert spoken.speaker == '陆青'
    assert spoken.dialogue_structured and spoken.dialogue_structured.line == '为何不答？'
    # This is the text TTS reads verbatim, so the speaker's name must not be inside it.
    from src.apps.comic_gen.audio import _effective_dialogue_text
    assert _effective_dialogue_text(spoken) == '为何不答？'
    assert '陆青' not in _effective_dialogue_text(spoken)

    silent = next(frame for frame, segment in zip(script.frames, script.production_plan.segments)
                  if not any(shot.dialogue for shot in segment.shots))
    assert not silent.dialogue and silent.dialogue_structured is None


def test_a_segment_with_two_speakers_keeps_the_lines_but_picks_no_voice(api_client, monkeypatch):
    from src.apps.comic_gen.pipeline import plan_dialogue_fields
    from src.apps.comic_gen.production_planning import PlanDialogue, PlannedShot

    def shot(*pairs, mode='on_screen'):
        return PlannedShot(id='shot', title='镜头', description='描述', camera='中景', duration=4,
                           source_quote='原文',
                           dialogue=[PlanDialogue(speaker=who, line=what, mode=mode) for who, what in pairs])

    both = plan_dialogue_fields([shot(('萧薰儿', '萧炎哥哥。')), shot(('萧炎', '别这么叫。'))])
    assert both['dialogue'] == '萧炎哥哥。\n别这么叫。'
    # Naming one of two speakers would be wrong; an empty speaker leaves the choice open.
    assert 'speaker' not in both and 'dialogue_structured' not in both

    narrated = plan_dialogue_fields([shot(('旁白', '斗气大陆，没有魔法。'), mode='voiceover')])
    assert narrated['dialogue_mode'] == 'voiceover'


def test_an_episode_made_before_the_fix_gets_its_dialogue_without_losing_its_videos(api_client, monkeypatch):
    """Re-applying the plan would fill the dialogue and destroy the takes along with it.

    斗破苍穹 had eight applied segments with videos already generated and every dialogue
    field empty. Apply archives and replaces frames, so the gap has to close in place.
    """
    project_id, _, _ = setup_plan(api_client, monkeypatch)
    draft = generate(api_client, project_id)['production_plan_draft']
    api_client.post(f'/projects/{project_id}/production-plan/apply',
                    json={'expected_revision': draft['revision']})
    script = api_module.pipeline.scripts[project_id]
    spoken = next(frame for frame, segment in zip(script.frames, script.production_plan.segments)
                  if any(shot.dialogue for shot in segment.shots))

    # Put the project back the way an episode made before the fix looks, with a take on it.
    spoken.dialogue = None
    spoken.dialogue_structured = None
    spoken.speaker = None
    spoken.video_url = 'video/existing-take.mp4'
    edited = next(frame for frame in script.frames if frame.id != spoken.id)
    edited.dialogue = '我改过的台词'
    api_module.pipeline._save_data()

    api_module.pipeline._backfill_plan_dialogue()

    filled = next(frame for frame in api_module.pipeline.scripts[project_id].frames if frame.id == spoken.id)
    assert filled.dialogue == '为何不答？' and filled.speaker == '陆青'
    assert filled.video_url == 'video/existing-take.mp4', "the take has to survive the repair"
    # An edited line belongs to the creator.
    kept = next(frame for frame in api_module.pipeline.scripts[project_id].frames if frame.id == edited.id)
    assert kept.dialogue == '我改过的台词'

    # Idempotent: running it again changes nothing.
    api_module.pipeline._backfill_plan_dialogue()
    assert next(f for f in api_module.pipeline.scripts[project_id].frames if f.id == edited.id).dialogue == '我改过的台词'
