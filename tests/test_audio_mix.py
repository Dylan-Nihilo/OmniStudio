from types import SimpleNamespace

from src.apps.comic_gen.models import Script, StoryboardFrame
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.apps.comic_gen.audio import AudioGenerator, get_bgm_presets


def _pipeline_with_script(frames):
    pipeline = object.__new__(ComicGenPipeline)
    pipeline.scripts = {
        "script-1": Script(
            id="script-1",
            title="Audio mix",
            original_text="",
            created_at=0,
            updated_at=0,
            frames=frames,
            bgm_url="audio/bgm.mp3",
            mix_settings={"dialogue": 80, "bgm": 30, "sfx": 60},
        )
    }
    return pipeline


def test_audio_mix_adds_sfx_inputs_at_cumulative_frame_offsets(monkeypatch):
    frames = [
        StoryboardFrame(id="frame-1", scene_id="scene", duration=2, sfx_url=None),
        StoryboardFrame(id="frame-2", scene_id="scene", duration=3, sfx_url="audio/door.wav"),
    ]
    pipeline = _pipeline_with_script(frames)
    commands = []

    monkeypatch.setattr(
        "src.apps.comic_gen.pipeline._safe_resolve_path",
        lambda base, relative: f"output/{relative}",
    )
    monkeypatch.setattr(
        "src.apps.comic_gen.pipeline.os.path.exists",
        lambda path: True,
    )

    def fake_run(command, **kwargs):
        commands.append(command)
        output = command[-1]
        with open(output, "wb") as handle:
            handle.write(b"mixed")
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr("src.apps.comic_gen.pipeline.subprocess.run", fake_run)

    result = pipeline._maybe_apply_bgm_mux(
        pipeline.scripts["script-1"],
        "output/merged.mp4",
        "ffmpeg",
        frames=frames,
    )

    assert result == "output/merged_mixed.mp4"
    command = commands[0]
    filter_graph = command[command.index("-filter_complex") + 1]
    assert "adelay=2000|2000" in filter_graph
    assert "amix=inputs=3" in filter_graph
    assert command.count("-i") == 3


def test_audio_mix_can_render_sfx_without_bgm(monkeypatch):
    frame = StoryboardFrame(id="frame-1", scene_id="scene", duration=4, sfx_url="audio/hit.wav")
    pipeline = _pipeline_with_script([frame])
    script = pipeline.scripts["script-1"]
    script.bgm_url = None
    commands = []

    monkeypatch.setattr(
        "src.apps.comic_gen.pipeline._safe_resolve_path",
        lambda base, relative: f"output/{relative}",
    )
    monkeypatch.setattr("src.apps.comic_gen.pipeline.os.path.exists", lambda path: True)

    def fake_run(command, **kwargs):
        commands.append(command)
        with open(command[-1], "wb") as handle:
            handle.write(b"mixed")
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr("src.apps.comic_gen.pipeline.subprocess.run", fake_run)

    result = pipeline._maybe_apply_bgm_mux(script, "output/merged.mp4", "ffmpeg", frames=[frame])

    assert result == "output/merged_mixed.mp4"
    filter_graph = commands[0][commands[0].index("-filter_complex") + 1]
    assert "amix=inputs=2" in filter_graph


def test_bgm_presets_expose_availability_instead_of_claiming_missing_files_exist(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    presets = get_bgm_presets()

    assert presets
    assert all(item["available"] is False for item in presets)


def test_bgm_generation_fails_explicitly_without_a_music_provider(tmp_path):
    generator = AudioGenerator({"output_dir": str(tmp_path / "audio")})
    frame = StoryboardFrame(id="frame-1", scene_id="scene")

    try:
        generator.generate_bgm(frame)
    except RuntimeError as exc:
        assert "BGM" in str(exc)
    else:
        raise AssertionError("BGM generation must not write a fake publishable audio file")
