"""The image relay answers the same request in two shapes, and both have to work.

Usually it returns an inline image. Under load it hands back an asynchronous task and
expects a poll. It is genuinely intermittent — the same model returned both shapes minutes
apart, and only the production run hit the async one — so neither shape can be assumed.
"""

from __future__ import annotations

import pytest

from src.models import mulerouter


class _Response:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200
        self.content = b"PNGBYTES"
        self.text = str(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


@pytest.fixture
def relay(monkeypatch, tmp_path):
    monkeypatch.setenv("OPEN302_API_KEY", "sk-test")
    monkeypatch.setattr(mulerouter.time, "sleep", lambda _: None)
    monkeypatch.setattr(mulerouter, "_download_file", lambda url, path: open(path, "wb").write(b"PNG"))
    return tmp_path


def _script(responses):
    calls = []

    def fake(method, url, **kwargs):
        calls.append((method, url))
        return _Response(responses[min(len(calls) - 1, len(responses) - 1)])

    return fake, calls


def test_a_tier_is_sent_to_the_relay_under_its_own_upstream_name(relay, monkeypatch):
    fake, calls = _script([{"data": [{"url": "https://cdn/img.png"}]}])
    monkeypatch.setattr(mulerouter, "_request_with_retry", fake)
    sent = {}

    def capture(method, url, **kwargs):
        sent.update(kwargs.get("json") or {})
        return fake(method, url, **kwargs)

    monkeypatch.setattr(mulerouter, "_request_with_retry", capture)
    mulerouter.MuleRouterImageModel({}).generate(
        "a cat", str(relay / "out.png"), model="gpt-image-2.5-sunburst")
    # The picker holds our tier id; the relay has to receive its own model name.
    assert sent["model"] == "gpt-image-2.5-sunburst"
    assert calls[0][1] == "https://open302.com/v1/images/generations"


@pytest.mark.parametrize("model_name", ["gemini-3.1-flash-image", "gpt-image-2", "gpt-image-2.5-sunburst"])
@pytest.mark.parametrize("consumer", ["holding_reference", "storyboard"])
def test_production_image_consumers_preserve_the_selected_tier(relay, monkeypatch, model_name, consumer):
    from pathlib import Path

    from src.apps.comic_gen.assets import AssetGenerator
    from src.apps.comic_gen.models import Character, GenerationStatus, StoryboardFrame
    from src.apps.comic_gen.storyboard import StoryboardGenerator
    from src.models.image import WanxImageModel
    from src.utils.oss_utils import OSSImageUploader

    monkeypatch.chdir(relay)
    monkeypatch.setattr(OSSImageUploader, "is_configured", property(lambda _: False))
    monkeypatch.setattr(WanxImageModel, "generate", lambda *args, **kwargs: pytest.fail("Image tier reached DashScope"))
    reference = relay / "reference.png"
    reference.write_bytes(b"fixture reference")
    sent = []

    def capture(method, url, **kwargs):
        sent.append((method, url, kwargs["data"]["model"], [item[1][1].read() for item in kwargs["files"]]))
        return _Response({"data": [{"url": "https://cdn/fixture.png"}]})

    monkeypatch.setattr(mulerouter, "_request_with_retry", capture)
    if consumer == "holding_reference":
        character = Character(id="actor", name="Actor", description="Holding a sword")
        result = AssetGenerator().generate_character(character, generation_type="holding_reference",
            model_name=model_name, reference_image_path=str(reference), prompt="Hold the reference prop")
        image_url = result.holding_reference.image_variants[0].url
    else:
        frame = StoryboardFrame(id="frame", scene_id="scene", action_description="An actor holds a sword")
        result = StoryboardGenerator().generate_frame(frame, [], None, model_name=model_name,
            ref_image_paths=[str(reference)])
        image_url = result.image_url

    assert result.status == GenerationStatus.COMPLETED
    assert Path("output", image_url).read_bytes() == b"PNG"
    assert sent == [("POST", "https://open302.com/v1/images/edits", model_name, [b"fixture reference"])]


def test_an_inline_image_is_used_directly(relay, monkeypatch):
    fake, calls = _script([{"data": [{"url": "https://cdn/img.png"}]}])
    monkeypatch.setattr(mulerouter, "_request_with_retry", fake)
    path, _ = mulerouter.MuleRouterImageModel({}).generate(
        "a cat", str(relay / "out.png"), model="gpt-image-2")
    assert open(path, "rb").read() == b"PNG"
    assert len(calls) == 1, "an inline image needs no polling"


def test_an_async_task_is_polled_until_it_finishes(relay, monkeypatch):
    fake, calls = _script([
        {"object": "image.generation.task", "id": "imgtask_1", "status": "running", "async": True},
        {"object": "image.generation.task", "id": "imgtask_1", "status": "running"},
        {"object": "image.generation.task", "id": "imgtask_1", "status": "succeeded",
         "data": [{"url": "https://cdn/late.png"}]},
    ])
    monkeypatch.setattr(mulerouter, "_request_with_retry", fake)
    path, _ = mulerouter.MuleRouterImageModel({}).generate(
        "a cat", str(relay / "out.png"), model="gpt-image-2.5-sunburst")
    assert open(path, "rb").read() == b"PNG"
    assert [method for method, _ in calls] == ["POST", "GET", "GET"]
    assert calls[1][1] == "https://open302.com/v1/images/generations/imgtask_1"


def test_a_failed_task_surfaces_the_relay_reason(relay, monkeypatch):
    fake, _ = _script([
        {"object": "image.generation.task", "id": "imgtask_2", "status": "running", "async": True},
        {"object": "image.generation.task", "id": "imgtask_2", "status": "failed",
         "error": {"message": "image task exceeded the 300 second limit"}},
    ])
    monkeypatch.setattr(mulerouter, "_request_with_retry", fake)
    with pytest.raises(RuntimeError, match="300 second limit"):
        mulerouter.MuleRouterImageModel({}).generate(
            "a cat", str(relay / "out.png"), model="gpt-image-2.5-sunburst")


def test_a_task_that_never_finishes_gives_up(relay, monkeypatch):
    fake, _ = _script([{"object": "image.generation.task", "id": "imgtask_3", "status": "running", "async": True}])
    monkeypatch.setattr(mulerouter, "_request_with_retry", fake)
    monkeypatch.setattr(mulerouter, "IMAGE_TASK_MAX_WAIT_SECONDS", 10)
    with pytest.raises(RuntimeError, match="did not finish"):
        mulerouter.MuleRouterImageModel({}).generate(
            "a cat", str(relay / "out.png"), model="gpt-image-2.5-sunburst")
