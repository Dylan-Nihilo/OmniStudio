"""Tests for PolishError 显式失败 + 双语锚点迭代 (#117 + #119).

旧实现遇到任何问题（LLM 未配置、JSON 解析失败、缺 key、API 异常）
都静默返回原文，前端无法区分"成功"和"失败 fallback"。本套测试
锁定新约定：每条失败路径都抛 PolishError(reason=...)，model_echo
作为 warning 性质保留双语原文。
"""

import json
from unittest.mock import MagicMock

import pytest

from src.apps.comic_gen.llm import (
    PolishError,
    ScriptProcessor,
    _is_echo,
)


# ---------------------------------------------------------------------------
# _is_echo unit tests
# ---------------------------------------------------------------------------

class TestIsEcho:
    def test_exact_match_after_normalize(self):
        assert _is_echo("Hello World", "  hello world  ") is True

    def test_high_similarity_above_threshold(self):
        a = "A cinematic wide shot of a hero standing on a cliff"
        b = "A cinematic wide shot of a hero standing on a cliff."  # 仅多一个句号
        assert _is_echo(a, b) is True

    def test_clearly_different(self):
        a = "wide shot of hero on cliff"
        b = "close-up of villain crying in the rain"
        assert _is_echo(a, b) is False

    def test_empty_inputs(self):
        assert _is_echo("", "anything") is False
        assert _is_echo("anything", "") is False


# ---------------------------------------------------------------------------
# polish_video_prompt error paths
# ---------------------------------------------------------------------------

class TestPolishVideoPromptErrors:
    @pytest.mark.parametrize(
        ("provider", "credential"),
        [
            ("dashscope", "DASHSCOPE_API_KEY"),
            ("openai", "OPENAI_API_KEY"),
        ],
    )
    def test_missing_configuration_names_provider_credential(self, provider, credential):
        sp = ScriptProcessor.__new__(ScriptProcessor)
        sp.llm = MagicMock()
        sp.llm.provider = provider
        sp.llm.is_configured = False

        with pytest.raises(PolishError) as exc_info:
            sp.polish_video_prompt("draft")

        assert credential in exc_info.value.message_en

    def test_is_configured_false_raises(self):
        sp = ScriptProcessor.__new__(ScriptProcessor)
        sp.llm = MagicMock()
        # is_configured 是 property，代理到 self.llm.is_configured
        sp.llm.is_configured = False
        with pytest.raises(PolishError) as exc_info:
            sp.polish_video_prompt("draft")
        assert exc_info.value.reason == "is_configured_false"

    def test_api_error_raises(self):
        sp = ScriptProcessor.__new__(ScriptProcessor)
        sp.llm = MagicMock()
        sp.llm.is_configured = True
        sp.llm.chat.side_effect = RuntimeError("DashScope API error: timeout")
        with pytest.raises(PolishError) as exc_info:
            sp.polish_video_prompt("draft prompt")
        assert exc_info.value.reason == "api_error"
        assert "timeout" in exc_info.value.message_zh or "timeout" in exc_info.value.message_en

    def test_json_parse_error_raises(self):
        sp = ScriptProcessor.__new__(ScriptProcessor)
        sp.llm = MagicMock()
        sp.llm.is_configured = True
        sp.llm.chat.return_value = "this is not JSON at all"
        with pytest.raises(PolishError) as exc_info:
            sp.polish_video_prompt("draft prompt")
        assert exc_info.value.reason == "json_parse_error"

    def test_missing_keys_raises(self):
        sp = ScriptProcessor.__new__(ScriptProcessor)
        sp.llm = MagicMock()
        sp.llm.is_configured = True
        sp.llm.chat.return_value = json.dumps({"only_cn": "x"})  # 缺 prompt_en
        with pytest.raises(PolishError) as exc_info:
            sp.polish_video_prompt("draft prompt")
        assert exc_info.value.reason == "missing_keys"

    def test_model_echo_raises_with_prompts(self):
        """model_echo 是 warning：抛异常但携带双语原文供前端展示。"""
        sp = ScriptProcessor.__new__(ScriptProcessor)
        sp.llm = MagicMock()
        sp.llm.is_configured = True
        sp.llm.chat.return_value = json.dumps({
            "prompt_cn": "镜头：一个英雄站在悬崖上",
            "prompt_en": "draft prompt",  # 模型偷懒回 echo
        })
        with pytest.raises(PolishError) as exc_info:
            sp.polish_video_prompt("draft prompt")
        assert exc_info.value.reason == "model_echo"
        assert exc_info.value.prompt_cn == "镜头：一个英雄站在悬崖上"
        assert exc_info.value.prompt_en == "draft prompt"

    def test_success_returns_bilingual(self):
        sp = ScriptProcessor.__new__(ScriptProcessor)
        sp.llm = MagicMock()
        sp.llm.is_configured = True
        sp.llm.chat.return_value = json.dumps({
            "prompt_cn": "电影感广角：英雄静立悬崖之上，眺望远方海雾",
            "prompt_en": "Cinematic wide shot: a heroic figure standing on a cliff, gazing into distant sea mist",
        })
        result = sp.polish_video_prompt("hero on cliff")
        assert "prompt_cn" in result
        assert "prompt_en" in result
        assert "Cinematic" in result["prompt_en"]


# ---------------------------------------------------------------------------
# 双语锚点迭代 (#119)
# ---------------------------------------------------------------------------

class TestBilingualAnchoredIteration:
    def test_first_polish_no_prev_cn(self):
        """首次 polish：不传 prev_cn，user_message 是 draft_prompt 本身。"""
        sp = ScriptProcessor.__new__(ScriptProcessor)
        sp.llm = MagicMock()
        sp.llm.is_configured = True
        sp.llm.chat.return_value = json.dumps({
            "prompt_cn": "改写版", "prompt_en": "Polished version",
        })
        sp.polish_video_prompt("hero on cliff")
        # 第一参数 messages，最后一条 user 消息就是 draft
        call = sp.llm.chat.call_args
        messages = call.kwargs["messages"] if "messages" in call.kwargs else call.args[0]
        assert messages[-1]["content"] == "hero on cliff"

    def test_iteration_with_prev_cn_uses_bilingual_anchor(self):
        """迭代 + prev_cn：user_message 同时包含 CN + EN + 反馈。"""
        sp = ScriptProcessor.__new__(ScriptProcessor)
        sp.llm = MagicMock()
        sp.llm.is_configured = True
        sp.llm.chat.return_value = json.dumps({
            "prompt_cn": "迭代版", "prompt_en": "Iterated version unique",
        })
        sp.polish_video_prompt(
            draft_prompt="Polished EN previous",
            feedback="把第二句改成俯视角",
            prev_cn="电影感广角：英雄站立悬崖",
        )
        call = sp.llm.chat.call_args
        messages = call.kwargs["messages"] if "messages" in call.kwargs else call.args[0]
        user_content = messages[-1]["content"]
        assert "电影感广角" in user_content  # CN 锚点
        assert "Polished EN previous" in user_content  # EN 上次结果
        assert "把第二句改成俯视角" in user_content  # 反馈
        assert "双语" in user_content  # 提示模型同步双语

    def test_iteration_without_prev_cn_falls_back_to_legacy_format(self):
        """向后兼容：旧调用方未带 prev_cn 时，仍走单语反馈格式。"""
        sp = ScriptProcessor.__new__(ScriptProcessor)
        sp.llm = MagicMock()
        sp.llm.is_configured = True
        sp.llm.chat.return_value = json.dumps({
            "prompt_cn": "改", "prompt_en": "Changed text X",
        })
        sp.polish_video_prompt(
            draft_prompt="Polished EN previous",
            feedback="make it darker",
        )
        call = sp.llm.chat.call_args
        messages = call.kwargs["messages"] if "messages" in call.kwargs else call.args[0]
        user_content = messages[-1]["content"]
        assert "[当前提示词]" in user_content  # 旧格式
        assert "[当前提示词-CN]" not in user_content  # 没用双语锚点格式


# ---------------------------------------------------------------------------
# polish_r2v_prompt parity（同样的错误路径，简化版）
# ---------------------------------------------------------------------------

class TestPolishR2VPromptErrors:
    def test_is_configured_false_raises(self):
        sp = ScriptProcessor.__new__(ScriptProcessor)
        sp.llm = MagicMock()
        sp.llm.is_configured = False
        with pytest.raises(PolishError) as exc_info:
            sp.polish_r2v_prompt("draft", slots=[])
        assert exc_info.value.reason == "is_configured_false"

    def test_r2v_bilingual_anchor(self):
        sp = ScriptProcessor.__new__(ScriptProcessor)
        sp.llm = MagicMock()
        sp.llm.is_configured = True
        sp.llm.chat.return_value = json.dumps({
            "prompt_cn": "迭代", "prompt_en": "Iterated R2V different text",
        })
        sp.polish_r2v_prompt(
            draft_prompt="character1 walks forward",
            slots=[{"description": "雷震"}],
            feedback="加慢动作",
            prev_cn="character1 缓慢前行",
        )
        call = sp.llm.chat.call_args
        messages = call.kwargs["messages"] if "messages" in call.kwargs else call.args[0]
        user_content = messages[-1]["content"]
        assert "character1 缓慢前行" in user_content
        assert "character1 walks forward" in user_content
        assert "加慢动作" in user_content
