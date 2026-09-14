from unittest.mock import Mock

import pytest

from src.models.image import WanxImageModel


@pytest.mark.parametrize("model_name,refs", [
    ("qwen-image-3.0-pro", []),
    ("qwen-image-3.0-pro", ["scene.png", "character.png", "scene.png"]),
    ("qwen-image-2.0-pro", []),
    ("qwen-image-2.0-pro", ["scene.png", "character.png", "scene.png"]),
    ("wan2.7-image-pro", []),
])
def test_image_generation_uses_provider_contract(monkeypatch, tmp_path, model_name, refs):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    monkeypatch.setattr("src.models.image.get_provider_base_url", lambda _: "https://provider.example")
    monkeypatch.setattr("src.models.image.time.sleep", lambda _: None)
    model = WanxImageModel({})
    monkeypatch.setattr(model, "_resolve_wan26_reference_image", lambda path, **_: "data:image/png;base64," + path)
    download = Mock()
    monkeypatch.setattr(model, "_download_image", download)
    output = {"choices": [{"message": {"content": [{"text": "ready"}, {"image": "https://provider.example/image.png"}]}}]}
    is_qwen = model_name.startswith("qwen")
    submit = Mock(return_value=Mock(status_code=200, text="{}", json=lambda: {"output": output if is_qwen else {"task_id": "task-1"}}))
    # Wan's existing task response contains the image as its first content item.
    poll = Mock(return_value=Mock(status_code=200, json=lambda: {"output": {"task_status": "SUCCEEDED", "choices": [{"message": {"content": [{"image": "https://provider.example/image.png"}]}}]}}))
    monkeypatch.setattr("src.models.image.requests.post", submit)
    monkeypatch.setattr("src.models.image.requests.get", poll)

    path = str(tmp_path / "image.png")
    assert model.generate("Use image 1 as the scene and image 2 as the character", path,
                          model_name=model_name, ref_image_paths=refs, seed=0)[0] == path

    url = submit.call_args.args[0]
    params = submit.call_args.kwargs
    assert url.endswith("/multimodal-generation/generation" if is_qwen else "/image-generation/generation")
    assert ("X-DashScope-Async" in params["headers"]) is (not is_qwen)
    assert params["json"]["parameters"]["seed"] == 0
    content = params["json"]["input"]["messages"][0]["content"]
    assert [item["image"] for item in content if "image" in item] == [
        "data:image/png;base64," + ref for ref in dict.fromkeys(refs)
    ]
    assert poll.call_count == (0 if is_qwen else 1)
    download.assert_called_once_with("https://provider.example/image.png", path)


def test_qwen_rejects_success_without_image(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    monkeypatch.setattr("src.models.image.requests.post", Mock(return_value=Mock(
        status_code=200, text="{}", json=lambda: {"output": {"choices": []}}
    )))
    with pytest.raises(RuntimeError, match="returned no image"):
        WanxImageModel({}).generate("scene", "unused.png", model_name="qwen-image-2.0-pro")


@pytest.mark.parametrize("model_name", ["qwen-image-2.0-pro", "qwen-image-3.0-pro"])
def test_qwen_rejects_extra_references_before_spending_a_generation(monkeypatch, model_name):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    submit = Mock()
    monkeypatch.setattr("src.models.image.requests.post", submit)
    with pytest.raises(ValueError, match="最多支持 3 张参考图"):
        WanxImageModel({}).generate("Do not lose the leaf in image 4", "unused.png",
            model_name=model_name, ref_image_paths=["joan.png", "sue.png", "room.png", "leaf.png"])
    submit.assert_not_called()
