"""api.py / playground translate a generation request into the billing spec the hook quotes."""

from __future__ import annotations

import pytest

from src.apps.comic_gen import api as api_module
from src.apps.comic_gen.models import ModelSettings, Script, VideoTask
from src.apps.playground.api import _billing_spec as playground_billing_spec
from src.apps.playground.models import GenerateRequest, PlaygroundMode


class _Pipeline:
    def __init__(self, script=None, tasks=None):
        self._script = script
        self.asset_generation_tasks = tasks or {}

    def get_script(self, script_id):
        return self._script


@pytest.fixture
def pipeline(monkeypatch):
    script = Script(id="p1", title="项目", original_text="", created_at=0.0, updated_at=0.0,
                    model_settings=ModelSettings(image_model="wan2.7-image-pro", character_aspect_ratio="9:16"))
    fake = _Pipeline(script=script)
    monkeypatch.setattr(api_module, "pipeline", fake)
    return fake


def test_project_asset_spec_uses_project_defaults_and_view_count(pipeline):
    pipeline.asset_generation_tasks["t1"] = {
        "script_id": "p1", "params": {"generation_type": "all", "batch_size": 2, "model_name": None, "aspect_ratio": "16:9"}}
    spec = api_module._billing_spec("asset", "p1", {"legacy_task_id": "t1"})
    assert spec["model_id"] == "wan2.7-image-pro" and spec["stage"] == "image"
    assert spec["quantity"] == 6                      # 2 per batch x 3 views for "all"
    assert spec["params"]["size"] == "1024*576"       # 16:9 from the request, not the project 9:16 default


def test_series_asset_spec_uses_the_resolved_model_and_size(pipeline):
    task = {"script_id": "s1", "is_series": True,
            "params": {"generation_type": "reference_sheet", "batch_size": 3, "t2i_model": "qwen-image-2.0-pro",
                       "effective_size": "576*1024"}}
    spec = api_module._billing_spec("asset", "s1", {"legacy_task": task})
    assert spec == {"model_id": "qwen-image-2.0-pro", "stage": "image",
                    "params": {"size": "576*1024"}, "quantity": 3}


def test_video_spec_reads_the_task_after_model_resolution(pipeline):
    # create_video_task may rewrite the model (i2v -> r2v), so the spec must come from the task
    pipeline._script.video_tasks = [VideoTask(id="v1", project_id="p1", image_url="a.png", prompt="p", model="wan2.7-r2v",
                                              duration=8, resolution="1080p", generation_mode="r2v")]
    spec = api_module._billing_spec("video", "p1", {"video_task_id": "v1"})
    assert spec["model_id"] == "wan2.7-r2v" and spec["quantity"] == 8
    assert spec["params"]["resolution"] == "1080p"
    assert api_module._billing_spec("video", "p1", {"video_task_id": "missing"}) is None


def test_export_and_audio_are_not_job_billed(pipeline):
    # merge/export is local ffmpeg; TTS is charged per synthesize call instead
    assert api_module._billing_spec("export", "p1", {"project_id": "p1"}) is None
    assert api_module._billing_spec("audio", "p1", {"project_id": "p1"}) is None


def test_missing_workspace_blocks_generation_only_when_billing_is_on(pipeline, monkeypatch):
    class _Repo:
        def workspace_for_script(self, _):
            return None

        def workspace_for_series(self, _):
            return None

    pipeline.repository = _Repo()
    monkeypatch.setattr(api_module, "billing_enabled", lambda: False)
    assert api_module._create_production_item("video", "p1", None, {}, "k1") is None

    monkeypatch.setattr(api_module, "billing_enabled", lambda: True)
    with pytest.raises(api_module.HTTPException) as blocked:
        api_module._create_production_item("video", "p1", None, {}, "k2")
    assert blocked.value.status_code == 409


@pytest.mark.parametrize(
    "mode,parameters,batch,expected",
    [
        (PlaygroundMode.T2I, {"size": "2048*2048"}, 3, {"stage": "image", "quantity": 3}),
        (PlaygroundMode.I2V, {"duration": 6, "resolution": "720p"}, 2, {"stage": "video", "quantity": 12}),
        (PlaygroundMode.T2V, {}, 1, {"stage": "video", "quantity": 5}),   # default duration
    ],
)
def test_playground_spec_covers_images_and_video_batches(mode, parameters, batch, expected):
    request = GenerateRequest(mode=mode, model_id="seedance-2.0-i2v", prompt="p",
                              parameters=parameters, batch_size=batch)
    spec = playground_billing_spec(request)
    assert spec["model_id"] == "seedance-2.0-i2v"
    assert spec["stage"] == expected["stage"] and spec["quantity"] == expected["quantity"]
