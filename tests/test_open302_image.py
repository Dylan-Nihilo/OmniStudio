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


# --- what the upstream said when it refused ------------------------------------------

class _Refusal:
    """A 4xx carrying the only text that explains itself."""

    def __init__(self, status_code, text, url="https://open302.com/v1/images/generations?x=1",
                 headers=None):
        self.status_code = status_code
        self.text = text
        self.url = url
        self.headers = headers or {}

    def json(self):
        raise ValueError("not json")


def test_a_user_is_told_the_cause_and_not_our_endpoint(caplog):
    """Deliberate reversal of what this file asserted an hour ago.

    The first attempt at fixing the opaque "451 Client Error ... for url: ..." put the
    upstream's own text and the endpoint into the user-facing message. That leaks which
    vendor we buy capacity from and where we call it, which is not a customer's business —
    and the provider's raw wording is not something they can act on anyway. The detail
    belongs in the log; the user gets a cause.
    """
    resp = _Refusal(451, '{"error":{"message":"content blocked by upstream policy"}}')
    with caplog.at_level("ERROR"):
        mulerouter._log_http_failure(resp)
    message = mulerouter._describe_http_failure(resp)

    assert "open302.com" not in message and "http" not in message.lower()
    assert "content blocked" not in message, "the provider's own wording is not shown"
    assert "改写画面描述" in message and "重试不会有帮助" in message
    # The same facts are still recoverable, just not by the customer.
    assert "open302.com" in caplog.text and "content blocked" in caplog.text


def test_the_log_keeps_the_blocking_party_for_a_451(caplog):
    """RFC 7725 names whoever demanded the block, which separates "this prompt was refused"
    from "this account or region is blocked"."""
    resp = _Refusal(451, "", headers={"Link": '<https://example.test/policy>; rel="blocked-by"'})
    with caplog.at_level("ERROR"):
        mulerouter._log_http_failure(resp)
    assert "blocked-by" in caplog.text


def test_every_cause_a_user_sees_is_free_of_vendor_detail():
    for status in (400, 401, 402, 403, 404, 413, 429, 451, 500, 503, 418):
        message = mulerouter._describe_http_failure(_Refusal(status, "vendor said something"))
        assert message and "vendor said" not in message
        assert "http" not in message.lower() and str(status) not in message


def test_a_failed_request_raises_the_cause_not_the_status_line(monkeypatch):
    monkeypatch.setattr(mulerouter.time, "sleep", lambda _s: None)
    monkeypatch.setattr(mulerouter.requests, "request",
                        lambda *a, **k: _Refusal(451, "policy refusal"))
    with pytest.raises(RuntimeError, match="改写画面描述"):
        mulerouter._request_with_retry("POST", "https://open302.com/v1/images/generations")


def test_a_content_refusal_is_not_retried(monkeypatch):
    """Retrying a refusal wastes a minute of someone's time to arrive at the same answer."""
    calls = {"n": 0}

    def once(*args, **kwargs):
        calls["n"] += 1
        return _Refusal(451, "policy refusal")

    monkeypatch.setattr(mulerouter.time, "sleep", lambda _s: None)
    monkeypatch.setattr(mulerouter.requests, "request", once)
    with pytest.raises(RuntimeError):
        mulerouter._request_with_retry("POST", "https://open302.com/v1/images/generations")
    assert calls["n"] == 1
