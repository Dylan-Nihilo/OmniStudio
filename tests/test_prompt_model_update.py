from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.apps.comic_gen import api
from src.apps.comic_gen.models import PromptConfig


@pytest.mark.parametrize('payload,expected', [
    ({'polish_model': 'gpt-5.6-sol'}, 'gpt-5.6-sol'),
    ({'polish_model': ''}, ''),
    ({'storyboard_polish': 'updated prompt'}, 'gpt-5.6-sol'),
])
def test_project_polish_model_can_be_set_reset_or_preserved(monkeypatch, payload, expected):
    script = SimpleNamespace(prompt_config=PromptConfig(polish_model='gpt-5.6-sol'))
    save = Mock()
    monkeypatch.setattr(api, 'pipeline', SimpleNamespace(get_script=lambda _: script, _save_data=save))
    result = api.update_prompt_config('project', api.UpdatePromptConfigRequest(**payload))
    assert result['prompt_config']['polish_model'] == expected
    assert script.prompt_config.polish_model == expected
    save.assert_called_once()
