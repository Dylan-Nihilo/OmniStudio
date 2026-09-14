from types import SimpleNamespace

import pytest

from src.models import videoretalk


def test_retalk_uses_clean_audio_and_resumes_without_submitting_twice(monkeypatch, tmp_path):
    uploaded, submissions, downloads, remembered = [], [], [], []
    transport = SimpleNamespace(api_key="test-key",
        _create_dashscope_temp_url=lambda path, model: uploaded.append((path, model)) or f"oss://{path}",
        _download_video=lambda url, path: downloads.append((url, path)))
    monkeypatch.setattr(videoretalk, "WanxModel", lambda config: transport)
    monkeypatch.setattr(videoretalk, "get_provider_base_url", lambda provider: "https://dashscope.example")
    monkeypatch.setattr(videoretalk.requests, "post", lambda url, **kwargs:
        submissions.append((url, kwargs)) or SimpleNamespace(status_code=200, json=lambda: {"output": {"task_id": "task-1"}}))
    monkeypatch.setattr(videoretalk.requests, "get", lambda url, **kwargs:
        SimpleNamespace(status_code=200, json=lambda: {"output": {"task_status": "SUCCEEDED", "video_url": "https://media.example/result.mp4"}}))
    destination = str(tmp_path / "output.mp4")
    videoretalk.replace_lip_sync("source.mp4", "voice.wav", destination, face_image_path="speaker.png", on_submitted=remembered.append)
    videoretalk.replace_lip_sync("source.mp4", "voice.wav", destination, task_id="task-1")
    assert len(submissions) == 1 and len(uploaded) == 3 and len(downloads) == 2
    assert remembered == ["task-1"]
    payload = submissions[0][1]
    assert payload["json"] == {"model": "videoretalk", "input": {"video_url": "oss://source.mp4", "audio_url": "oss://voice.wav", "ref_image_url": "oss://speaker.png"}, "parameters": {"video_extension": False}}
    assert payload["headers"]["X-DashScope-OssResourceResolve"] == "enable"


def test_retalk_failure_does_not_download_or_resubmit(monkeypatch):
    monkeypatch.setattr(videoretalk, "WanxModel", lambda config: SimpleNamespace(api_key="test-key"))
    monkeypatch.setattr(videoretalk.requests, "post", lambda *args, **kwargs: pytest.fail("Do not resubmit a recorded task"))
    monkeypatch.setattr(videoretalk.requests, "get", lambda *args, **kwargs:
        SimpleNamespace(status_code=200, json=lambda: {"output": {"task_status": "FAILED", "code": "InvalidFile.Content"}}))
    with pytest.raises(RuntimeError, match="InvalidFile.Content"):
        videoretalk.replace_lip_sync("source.mp4", "voice.wav", "output.mp4", task_id="task-1")


def test_dashscope_download_uses_https_without_changing_signed_query(monkeypatch, tmp_path):
    from src.models.wanx import WanxModel
    urls = []
    response = SimpleNamespace(raise_for_status=lambda: None, iter_content=lambda **kwargs: [b"video"])
    session = SimpleNamespace(mount=lambda *args: None, get=lambda url, **kwargs: urls.append(url) or response)
    monkeypatch.setattr("src.models.wanx.requests.Session", lambda: session)
    output = tmp_path / "result.mp4"
    WanxModel({})._download_video("http://result.oss-cn-shanghai.aliyuncs.com/output.mp4?Expires=123&Signature=abc%2Bdef", str(output))
    assert urls == ["https://result.oss-cn-shanghai.aliyuncs.com/output.mp4?Expires=123&Signature=abc%2Bdef"]
    assert output.read_bytes() == b"video"
