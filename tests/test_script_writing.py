"""Writing previews and continuity reviews use the script API without replacing user text."""
import json

import pytest

from src.apps.comic_gen import api as api_module
from src.apps.comic_gen.llm_adapter import LLMAdapter
from tests.test_w2_project_api import api_client, _create_project


def configure_writer(client, monkeypatch, answer):
    result = client.post('/config/env', json={'LLM_PROVIDER': 'openai', 'OPENAI_API_KEY': 'fixture-key', 'OPENAI_MODEL': 'fixture-writer'})
    assert result.status_code == 200
    calls = []
    def chat(self, messages, **kwargs):
        assert self.provider == 'openai' and self._get_default_model() == 'fixture-writer'
        assert self.is_configured
        calls.append(json.loads(messages[1]['content']))
        payload = json.dumps(answer, ensure_ascii=False)
        # Feed it in pieces like the real adapter does, so callers that report progress are
        # exercised rather than silently skipped by the stub.
        on_progress = kwargs.get('on_progress')
        if on_progress is not None:
            for cut in range(0, len(payload), 120):
                on_progress(payload[:cut + 120])
        return payload
    monkeypatch.setattr(LLMAdapter, 'chat', chat)
    return calls


@pytest.mark.parametrize('scope,selection,target', [
    ('selection', {'start': 1, 'end': 3}, '😀'),
    ('paragraph', {'start': 0, 'end': 4}, '甲😀乙'),
    ('document', None, '甲😀乙\n后文保持原样。'),
])
def test_writing_proposes_only_the_requested_range_without_saving(api_client, monkeypatch, scope, selection, target):
    project = _create_project(api_client, 'Writing preview')
    before = api_client.get('/projects/' + project['id']).json()
    calls = configure_writer(api_client, monkeypatch, {'replacement': '新写法', 'summary': '保留原意'})
    response = api_client.post(f"/projects/{project['id']}/writing/preview", json={
        'text': '甲😀乙\n后文保持原样。', 'scope': scope, 'selection': selection,
        'action': 'polish', 'instruction': '更克制',
    })
    assert response.status_code == 200, response.text
    assert response.json()['original'] == target
    assert response.json()['replacement'] == '新写法'
    assert calls[0]['target'] == target and calls[0]['full_text'].endswith('后文保持原样。')
    assert api_client.get('/projects/' + project['id']).json()['original_text'] == before['original_text']


@pytest.mark.parametrize('selection', [{'start': 2, 'end': 3}, {'start': 0, 'end': 50}, {'start': 3, 'end': 1}, None])
def test_invalid_selection_is_rejected_before_model_call(api_client, monkeypatch, selection):
    project = _create_project(api_client, 'Invalid selection')
    calls = configure_writer(api_client, monkeypatch, {'replacement': 'wrong'})
    response = api_client.post(f"/projects/{project['id']}/writing/preview", json={
        'text': '甲😀乙', 'scope': 'selection', 'selection': selection,
    })
    assert response.status_code == 422
    assert calls == []


def test_an_idea_can_generate_a_script_from_an_empty_document(api_client, monkeypatch):
    project = _create_project(api_client, 'Idea')
    calls = configure_writer(api_client, monkeypatch, {'replacement': '夜，破亭。\n少年收剑。', 'summary': '一场和解'})
    response = api_client.post(f"/projects/{project['id']}/writing/preview", json={
        'text': '', 'instruction': '写一部少年与师父和解的武侠短剧', 'action': 'expand',
    })
    assert response.status_code == 200 and response.json()['replacement'].startswith('夜，破亭。')
    assert calls[0]['instruction'].startswith('写一部')


@pytest.mark.parametrize('grounded', [True, False])
def test_continuity_issues_must_quote_both_passages_from_current_text(api_client, monkeypatch, grounded):
    project = _create_project(api_client, 'Continuity')
    issue = {'category': 'object', 'severity': 'error', 'quote': '他的右臂已经断了。',
        'related_quote': '他抬起右手握剑。' if grounded else '他拔出一把手枪。',
        'message': '右臂状态与后文动作冲突', 'suggestion': '把后文改成左手握剑。'}
    calls = configure_writer(api_client, monkeypatch, {'issues': [issue]})
    response = api_client.post(f"/projects/{project['id']}/writing/continuity", json={
        'text': '他的右臂已经断了。\n他抬起右手握剑。', 'previous_text': '他双臂健全。\n他抬起右手握剑。',
    })
    assert response.status_code == (200 if grounded else 502), response.text
    assert calls[0]['previous_text'].startswith('他双臂健全')
    if grounded: assert response.json()['issues'] == [issue]


def test_clean_continuity_result_and_failed_model_do_not_change_the_script(api_client, monkeypatch):
    project = _create_project(api_client, 'Clean report')
    configure_writer(api_client, monkeypatch, {'issues': []})
    route = f"/projects/{project['id']}/writing/continuity"
    assert api_client.post(route, json={'text': '他收剑，转身走出亭子。'}).json()['issues'] == []
    def fail(*args, **kwargs): raise RuntimeError('fixture-key rejected')
    monkeypatch.setattr(LLMAdapter, 'chat', fail)
    response = api_client.post(route, json={'text': '保留我的草稿。'})
    assert response.status_code == 502 and 'fixture-key' not in response.text
    assert api_module._script_writing_inflight == set()


def test_writing_does_not_resolve_another_workspace_project(api_client, monkeypatch):
    configure_writer(api_client, monkeypatch, {'replacement': 'not allowed'})
    response = api_client.post('/projects/unknown-workspace-project/writing/preview', json={'text': '保留正文'})
    assert response.status_code == 404
