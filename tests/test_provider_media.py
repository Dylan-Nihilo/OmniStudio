import base64
from pathlib import Path

import pytest

from src.utils.provider_media import (
    RESOLVE_HEADER_DASHSCOPE_OSS_RESOURCE,
    resolve_media_input,
    resolve_media_inputs,
)


PNG_1X1_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+"
    "X2VINQAAAABJRU5ErkJggg=="
)


class FakeUploader:
    def __init__(self, configured: bool):
        self.is_configured = configured
        self.uploaded_paths = []

    def upload_file(self, local_path: str, sub_path: str = "", custom_filename=None):
        if not self.is_configured:
            return None
        self.uploaded_paths.append((local_path, sub_path))
        filename = custom_filename or Path(local_path).name
        return f"omni_studio/{sub_path.strip('/')}/{filename}".replace("//", "/")

    def sign_url_for_api(self, object_key: str):
        return f"https://oss.example/{object_key}"


def _write_output_png(project_root: Path, rel_path: str) -> Path:
    output_root = project_root / "output"
    file_path = output_root / rel_path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(base64.b64decode(PNG_1X1_BASE64))
    return file_path


def test_dashscope_image_local_without_oss_uses_data_uri(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    ref = "uploads/ref.png"
    uploader = FakeUploader(configured=False)

    resolved = resolve_media_input(
        ref,
        model_name="wan2.6-image",
        backend="dashscope",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert resolved.value.startswith("data:image/png;base64,")
    assert resolved.headers == {}
    assert ref == "uploads/ref.png"


@pytest.mark.parametrize("configured_root", [False, True])
@pytest.mark.parametrize("reference", ["assets/scene.png", "video_inputs/shot.png"])
def test_moma_resolves_runtime_images_outside_source_checkout(tmp_path, monkeypatch, configured_root, reference):
    runtime = tmp_path / "runtime"
    _write_output_png(runtime, reference)
    monkeypatch.chdir(tmp_path if configured_root else runtime)
    if configured_root:
        monkeypatch.setenv("OMNI_STUDIO_MEDIA_PROJECT_ROOT", str(runtime))
    else:
        monkeypatch.delenv("OMNI_STUDIO_MEDIA_PROJECT_ROOT", raising=False)
    resolved = resolve_media_input(reference, model_name="minimax/minimax-h3",
                                   backend="moma", modality="image", uploader=FakeUploader(False))
    assert resolved.value == "data:image/png;base64," + PNG_1X1_BASE64


@pytest.mark.parametrize("modality", ["audio", "video", "reference_video"])
def test_dashscope_non_image_local_without_oss_uses_temp_url_and_header(tmp_path, modality):
    _write_output_png(tmp_path, "video/ref.mp4")
    uploader = FakeUploader(configured=False)

    def fake_temp_url_resolver(local_path: str) -> str:
        assert local_path.replace("\\", "/").endswith("output/video/ref.mp4")
        return "oss://dashscope-temp/session-file-001"

    resolved = resolve_media_input(
        "video/ref.mp4",
        model_name="wan2.6-i2v",
        backend="dashscope",
        modality=modality,
        uploader=uploader,
        project_root=str(tmp_path),
        dashscope_temp_url_resolver=fake_temp_url_resolver,
    )

    assert resolved.value == "oss://dashscope-temp/session-file-001"
    assert resolved.headers.get(RESOLVE_HEADER_DASHSCOPE_OSS_RESOURCE) == "enable"


def test_dashscope_non_image_local_without_oss_and_without_temp_resolver_fails_fast(tmp_path):
    _write_output_png(tmp_path, "video/ref.mp4")
    uploader = FakeUploader(configured=False)

    with pytest.raises(
        ValueError,
        match="requires OSS or a dashscope_temp_url_resolver",
    ):
        resolve_media_input(
            "video/ref.mp4",
            model_name="wan2.6-i2v",
            backend="dashscope",
            modality="audio",
            uploader=uploader,
            project_root=str(tmp_path),
        )


def test_dashscope_local_uses_oss_signed_url_when_configured(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    uploader = FakeUploader(configured=True)

    resolved = resolve_media_input(
        "uploads/ref.png",
        model_name="wan2.6-image",
        backend="dashscope",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert resolved.value.startswith("https://oss.example/omni_studio/temp/provider_media/")
    assert resolved.headers == {}
    assert uploader.uploaded_paths


def test_vendor_kling_image_local_uses_plain_base64(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    uploader = FakeUploader(configured=False)

    resolved = resolve_media_input(
        "uploads/ref.png",
        model_name="kling-v1",
        backend="vendor",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert not resolved.value.startswith("data:")
    assert resolved.value == PNG_1X1_BASE64
    assert resolved.headers == {}


def test_vendor_vidu_image_local_requires_url_capability(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    uploader = FakeUploader(configured=False)

    with pytest.raises(ValueError, match="requires a URL-compatible media source"):
        resolve_media_input(
            "uploads/ref.png",
            model_name="vidu-q3",
            backend="vendor",
            modality="image",
            uploader=uploader,
            project_root=str(tmp_path),
        )


def test_vendor_vidu_image_local_with_oss_uses_signed_url(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    uploader = FakeUploader(configured=True)

    resolved = resolve_media_input(
        "uploads/ref.png",
        model_name="vidu-q3",
        backend="vendor",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert resolved.value.startswith("https://oss.example/omni_studio/temp/provider_media/")


def test_jojokey_local_image_with_oss_uses_signed_url(tmp_path):
    _write_output_png(tmp_path, "storyboard/ref.png")
    uploader = FakeUploader(configured=True)

    resolved = resolve_media_input(
        "storyboard/ref.png",
        model_name="minimax/minimax-h3",
        backend="jojokey",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert resolved.value.startswith("https://oss.example/omni_studio/temp/provider_media/")


def test_jojokey_local_image_without_oss_fails_before_remote_submission(tmp_path):
    _write_output_png(tmp_path, "storyboard/ref.png")
    uploader = FakeUploader(configured=False)

    with pytest.raises(ValueError, match="Configure OSS or provide a remote HTTPS URL"):
        resolve_media_input(
            "storyboard/ref.png",
            model_name="minimax/minimax-h3",
            backend="jojokey",
            modality="image",
            uploader=uploader,
            project_root=str(tmp_path),
        )


def test_moma_local_image_without_oss_uses_data_uri(tmp_path):
    _write_output_png(tmp_path, "storyboard/ref.png")
    uploader = FakeUploader(configured=False)

    resolved = resolve_media_input(
        "storyboard/ref.png",
        model_name="minimax/minimax-h3",
        backend="moma",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )
    assert resolved.value == f"data:image/png;base64,{PNG_1X1_BASE64}"
    assert not uploader.uploaded_paths


def test_moma_local_dialogue_audio_does_not_require_a_bucket(tmp_path):
    audio = tmp_path / "output/audio/line.mp3"
    audio.parent.mkdir(parents=True)
    audio.write_bytes(b"voice reference")
    uploader = FakeUploader(configured=False)

    resolved = resolve_media_input("audio/line.mp3", model_name="minimax/minimax-h3",
        backend="moma", modality="audio", uploader=uploader, project_root=str(tmp_path))

    assert resolved.value == "data:audio/mp3;base64,dm9pY2UgcmVmZXJlbmNl"
    assert not uploader.uploaded_paths


def test_resolver_does_not_mutate_input_refs(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    uploader = FakeUploader(configured=False)
    refs = ["uploads/ref.png"]
    original = list(refs)

    resolved = resolve_media_inputs(
        refs,
        model_name="wan2.6-image",
        backend="dashscope",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert refs == original
    assert len(resolved) == 1
    assert resolved[0].value.startswith("data:image/png;base64,")
