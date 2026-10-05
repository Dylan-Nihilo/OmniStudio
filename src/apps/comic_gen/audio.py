import os
import subprocess
import time
import hashlib
import uuid
import math
from typing import Dict, Any, List, Optional
from .models import StoryboardFrame, Character, DialogueLine, GenerationStatus
from ...utils import get_logger
from ...utils.system_check import get_ffmpeg_path, get_ffprobe_path
from ...audio.tts import TTSProcessor

logger = get_logger(__name__)


def _compute_dialogue_hash(
    text: str,
    voice_id: Optional[str],
    instructions: Optional[str],
    speed: float = 1.0,
    pitch: float = 1.0,
    volume: int = 50,
) -> str:
    """PR-3j · Snapshot hash for stale detection. Frame is STALE when current
    (dialogue|voice_id|instructions) hash != stored snapshot."""
    payload = f"{text or ''}|{voice_id or ''}|{instructions or ''}|{float(speed):.4f}|{float(pitch):.4f}|{int(volume)}"
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


def _compute_sfx_fingerprint(description: Optional[str], video_url: Optional[str]) -> str:
    payload = f"{description or ''}|{video_url or ''}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# PR-3k · BGM preset catalog. Each entry maps a stable id → human label,
# mood tag, and a relative path under output/presets/bgm/. v1 ships the
# catalog only; actual audio files are dropped in by the operator. Availability
# is returned to the UI so a missing preset cannot look publishable.
BGM_PRESETS: List[Dict[str, Any]] = [
    {"id": "calm_warm",      "label": "温暖治愈",   "mood": "warm",      "url": "presets/bgm/calm_warm.mp3"},
    {"id": "uplifting_pop",  "label": "明朗轻快",   "mood": "uplifting", "url": "presets/bgm/uplifting_pop.mp3"},
    {"id": "epic_cinematic", "label": "史诗电影感", "mood": "epic",      "url": "presets/bgm/epic_cinematic.mp3"},
    {"id": "mystery_ambient","label": "悬疑氛围",   "mood": "mystery",   "url": "presets/bgm/mystery_ambient.mp3"},
    {"id": "sad_piano",      "label": "忧伤钢琴",   "mood": "sad",       "url": "presets/bgm/sad_piano.mp3"},
    {"id": "tension_drama",  "label": "紧张戏剧",   "mood": "tense",     "url": "presets/bgm/tension_drama.mp3"},
    {"id": "lofi_chill",     "label": "Lo-Fi 慵懒", "mood": "chill",     "url": "presets/bgm/lofi_chill.mp3"},
    {"id": "fantasy_dreamy", "label": "奇幻梦境",   "mood": "dreamy",    "url": "presets/bgm/fantasy_dreamy.mp3"},
]


def get_bgm_presets() -> List[Dict[str, Any]]:
    """PR-3k · Return BGM preset list. UI displays these in the Mix phase
    picker; selected entry's url is stored on Script.bgm_url."""
    presets = []
    for preset in BGM_PRESETS:
        item = dict(preset)
        item["available"] = os.path.isfile(os.path.join("output", preset["url"]))
        presets.append(item)
    return presets


def _effective_dialogue_text(frame: StoryboardFrame) -> str:
    """Prefer the per-speaker lines, then dialogue_structured.line, then legacy dialogue."""
    lines = getattr(frame, "dialogue_lines", None)
    if lines:
        return "\n".join(line.line for line in lines)
    if frame.dialogue_structured and frame.dialogue_structured.line:
        return frame.dialogue_structured.line
    return frame.dialogue or ""


def _compute_lines_hash(plans: List[Dict[str, Any]]) -> str:
    """Snapshot of every line and the voice it is spoken in.

    A frame is stale when any line's text, speaker, resolved voice, prosody or placement
    changes — reassigning one character's voice has to invalidate the whole track, because
    the track is assembled from all of them.
    """
    payload = "||".join(
        f"{plan['line'].speaker}|{plan['line'].line}|{plan['line'].start_seconds:.3f}"
        f"|{plan.get('voice') or ''}|{plan.get('instructions') or ''}"
        f"|{float(plan.get('speed', 1.0)):.4f}|{float(plan.get('pitch', 1.0)):.4f}|{int(plan.get('volume', 50))}"
        for plan in plans
    )
    # Invalidate tracks mixed at estimated anchors before sequential scheduling.
    return hashlib.md5(("sequential-v1||" + payload).encode("utf-8")).hexdigest()


def _effective_instructions(frame: StoryboardFrame) -> Optional[str]:
    """Prefer explicit dialogue_instructions; lazy-build from dialogue_structured if missing."""
    if frame.dialogue_instructions is not None:
        return frame.dialogue_instructions
    if frame.dialogue_structured:
        parts = []
        if frame.dialogue_structured.emotion:
            parts.append(f"情绪：{frame.dialogue_structured.emotion}")
        if frame.dialogue_structured.delivery:
            parts.append(f"演绎：{frame.dialogue_structured.delivery}")
        if parts:
            return "；".join(parts)
    return None


def dialogue_audio_is_stale(frame: StoryboardFrame, character: Optional[Character],
                            line_plans: Optional[List[Dict[str, Any]]] = None) -> bool:
    """True when frame.audio_url exists but its snapshot no longer matches
    the current (dialogue|voice|instructions) state.

    For a per-speaker frame the whole track is assembled from every line, so any line's
    text, placement or voice going out of date makes the track out of date — including a
    character's voice being reassigned somewhere else entirely. `line_plans` carries the
    freshly resolved voices; without them the per-line comparison cannot be made and the
    frame is reported stale rather than quietly passed as current.
    """
    if not frame.audio_url:
        return False
    if not frame.dialogue_text_hash:
        return True  # legacy frame without snapshot — treat as stale
    if getattr(frame, "dialogue_lines", None):
        if not line_plans:
            return True
        return _compute_lines_hash(line_plans) != frame.dialogue_text_hash
    voice_id = character.voice_id if character else frame.dialogue_voice_id
    text = _effective_dialogue_text(frame)
    instructions = _effective_instructions(frame)
    current = _compute_dialogue_hash(
        text,
        voice_id,
        instructions,
        getattr(character, "voice_speed", getattr(frame, "dialogue_snapshot_speed", 1.0)) if character else getattr(frame, "dialogue_snapshot_speed", 1.0),
        getattr(character, "voice_pitch", getattr(frame, "dialogue_snapshot_pitch", 1.0)) if character else getattr(frame, "dialogue_snapshot_pitch", 1.0),
        getattr(character, "voice_volume", getattr(frame, "dialogue_snapshot_volume", 50)) if character else getattr(frame, "dialogue_snapshot_volume", 50),
    )
    return current != frame.dialogue_text_hash

def _audio_duration(path: str) -> Optional[float]:
    try:
        output = subprocess.check_output(
            [get_ffprobe_path(), "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", path], text=True, timeout=30)
        return round(float(output.strip()), 3)
    except Exception:
        return None


def _assemble_dialogue_track(clips: List[tuple], output_path: str, total_duration: float) -> None:
    """Lay the clips onto one track at their offsets.

    `adelay` + `amix` is how dubbing already places audio against video in this repo (see
    `pipeline._build_dub_filter`), so the same idiom is used here rather than a second one.
    Pad to the segment window, but retain speech that exceeds it for alignment review.
    """
    if not clips:
        raise RuntimeError("没有可装配的对白片段")
    clip_ends = []
    previous_end = 0.0
    for clip, offset in clips:
        duration = _audio_duration(clip)
        if duration is None or not math.isfinite(duration) or duration <= 0:
            raise ValueError("无法读取对白时长，不能安全装配配音")
        if not math.isfinite(offset) or offset < 0:
            raise ValueError("对白起点无效，不能安全装配配音")
        if offset < previous_end - 0.001:
            raise ValueError("对白时间重叠，请重新校准配音")
        previous_end = offset + duration
        clip_ends.append(previous_end)
    command = [get_ffmpeg_path(), "-y", "-v", "error"]
    for clip, _offset in clips:
        command += ["-i", clip]
    filters = []
    for index, (_clip, offset) in enumerate(clips):
        delay = max(0, int(round((offset or 0) * 1000)))
        filters.append(f"[{index}:a]adelay={delay}|{delay}[a{index}]")
    labels = "".join(f"[a{index}]" for index in range(len(clips)))
    filters.append(f"{labels}amix=inputs={len(clips)}:duration=longest:dropout_transition=0,apad[out]")
    command += ["-filter_complex", ";".join(filters), "-map", "[out]"]
    command += ["-t", str(max(total_duration or 0, *clip_ends))]
    command += ["-ar", "48000", "-ac", "1", output_path]
    subprocess.run(command, check=True, capture_output=True, timeout=180)


class AudioGenerator:
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.output_dir = self.config.get('output_dir', 'output/audio')
        
        # Initialize TTS Processor
        try:
            self.tts = TTSProcessor()
            logger.info("TTS Processor initialized successfully")
        except Exception as e:
            logger.warning(f"Failed to initialize TTS Processor: {e}. Using mock mode.")
            self.tts = None

    def voice_carries_direction(self, voice_id: Optional[str], model_override: Optional[str] = None) -> bool:
        """Whether a delivery instruction given to this voice will be acted on.

        Two thirds of the catalogue is cosyvoice-v2, whose API has no such parameter, so
        the direction was accepted by the workbench and then thrown away — the line came
        back read flat and nothing said why. Without TTS configured nothing is
        synthesisable at all, so there is no capability to report.
        """
        if not voice_id or not self.tts:
            return False
        return self.tts.voice_supports_instruction(voice_id, model_override)

    def get_available_voices(self) -> List[Dict[str, Any]]:
        """Returns a list of available voices with full registry metadata.

        Shape expanded in PR-3g #3 — frontend voice picker (Q15.5 B) needs
        family/dialect/lang_primary/supports_instruction to render the
        3 tabs (系统音色 / 我的复刻 / 我的设计) with dialect/international
        sub-groupings inside 系统音色.
        """
        if self.tts:
            voices_dict = TTSProcessor.list_voices()
            return [
                {
                    # Use actual model_id (server sends "Cherry" not "qwen3_cherry")
                    # so frontend can pass it back unchanged for synthesis.
                    "id": meta['model_id'],
                    "name": meta['name'],
                    "gender": meta.get('gender', 'Unknown'),
                    "model": meta.get('model', 'cosyvoice-v2'),
                    "family": meta.get('family', 'cosyvoice'),
                    "supports_instruction": meta.get('supports_instruction', False),
                    "dialect": meta.get('dialect'),
                    "lang_primary": meta.get('lang_primary'),
                    "origin": "system",  # custom voices (clone/design) come from a separate endpoint
                }
                for meta in voices_dict.values()
            ]
        else:
            return [
                {"id": "longxiaochun_v2", "name": "龙小淳 (知性女) - CosyVoice", "gender": "Female", "family": "cosyvoice", "origin": "system"},
                {"id": "longyue_v2", "name": "龙悦 (温柔女) - CosyVoice", "gender": "Female", "family": "cosyvoice", "origin": "system"},
                {"id": "longcheng_v2", "name": "龙诚 (睿智青年) - CosyVoice", "gender": "Male", "family": "cosyvoice", "origin": "system"},
                {"id": "longshu_v2", "name": "龙书 (播报男) - CosyVoice", "gender": "Male", "family": "cosyvoice", "origin": "system"},
            ]

    def generate_dialogue(
        self,
        frame: StoryboardFrame,
        character: Character,
        speed: float = 1.0,
        pitch: float = 1.0,
        volume: int = 50,
        instructions: Optional[str] = None,
        model_override: Optional[str] = None,
        family_override: Optional[str] = None,
    ) -> StoryboardFrame:
        """Generates TTS audio for the dialogue."""
        text = _effective_dialogue_text(frame)
        if not text:
            return frame

        frame.status = GenerationStatus.PROCESSING

        if instructions is None:
            instructions = _effective_instructions(frame)

        logger.info(f"Generating dialogue for {character.name}: {text} (Speed: {speed}, Pitch: {pitch}, Volume: {volume}, instr: {instructions or '-'})")

        if not self.tts:
            frame.status = GenerationStatus.FAILED
            frame.audio_error = "TTS service not available. Check DASHSCOPE_API_KEY configuration."
            logger.warning(f"TTS not initialized, cannot generate audio for frame {frame.id}")
            return frame

        if not character.voice_id:
            frame.status = GenerationStatus.FAILED
            frame.audio_error = f"No voice assigned to character '{character.name}'. Please assign a voice first."
            logger.warning(f"No voice_id for character {character.name}, cannot generate audio")
            return frame

        return self._real_generate_dialogue(
            frame, character, text, speed, pitch, volume,
            instructions=instructions,
            model_override=model_override,
            family_override=family_override,
        )

    def _real_generate_dialogue(
        self,
        frame: StoryboardFrame,
        character: Character,
        text: str,
        speed: float,
        pitch: float,
        volume: int,
        instructions: Optional[str] = None,
        model_override: Optional[str] = None,
        family_override: Optional[str] = None,
    ) -> StoryboardFrame:
        """Generate dialogue using real TTS."""
        output_path = None
        try:
            output_path = os.path.join(self.output_dir, 'dialogue', f"{frame.id}_{uuid.uuid4().hex}.mp3")
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            voice = character.voice_id

            self.tts.synthesize(
                text, output_path, voice=voice,
                speech_rate=speed, pitch_rate=pitch, volume=volume,
                instructions=instructions,
                model_override=model_override,
                family_override=family_override,
            )
            if not os.path.isfile(output_path) or not os.path.getsize(output_path):
                raise RuntimeError("TTS did not produce an audio file")

            rel_path = os.path.relpath(output_path, "output")
            frame.audio_url = rel_path
            frame.audio_error = None
            frame.status = GenerationStatus.COMPLETED
            # PR-3j · snapshot for stale detection
            frame.dialogue_voice_id = voice
            frame.dialogue_snapshot_text = text
            frame.dialogue_instructions = instructions
            frame.dialogue_snapshot_speed = speed
            frame.dialogue_snapshot_pitch = pitch
            frame.dialogue_snapshot_volume = volume
            frame.dialogue_text_hash = _compute_dialogue_hash(text, voice, instructions, speed, pitch, volume)

        except Exception as e:
            if output_path and os.path.exists(output_path):
                try:
                    os.unlink(output_path)
                except OSError:
                    logger.warning("Could not remove failed dialogue output")
            logger.error(f"TTS generation failed for frame {frame.id}: {e}")
            frame.status = GenerationStatus.FAILED
            frame.audio_error = f"TTS generation failed: {str(e)}"

        return frame

    def generate_dialogue_lines(
        self,
        frame: StoryboardFrame,
        plans: List[Dict[str, Any]],
        total_duration: float,
    ) -> StoryboardFrame:
        """Synthesise each line in its own voice and lay them out over the segment.

        A segment is usually a conversation, and it used to be read start to finish in one
        voice because the frame held a single text and a single voice id. Each line is now
        spoken by its own character and placed at `start_seconds` — the offset of the shot
        it was written for — so the voice lands with the mouth that is moving.

        The result is still one `frame.audio_url`, so dubbing preview, mixing, lip-sync and
        export need no changes at all. Each clip is also kept on its line, which is what
        makes regenerating a single line possible.
        """
        if not plans:
            return frame
        frame.status = GenerationStatus.PROCESSING
        if not self.tts:
            frame.status = GenerationStatus.FAILED
            frame.audio_error = "TTS service not available. Check DASHSCOPE_API_KEY configuration."
            return frame

        folder = os.path.join(self.output_dir, "dialogue")
        os.makedirs(folder, exist_ok=True)
        written: List[str] = []
        try:
            previous_end = 0.0
            for index, plan in enumerate(plans):
                line: DialogueLine = plan["line"]
                voice = plan.get("voice")
                if not voice:
                    raise RuntimeError(f"「{line.speaker}」没有可用音色")
                clip = os.path.join(folder, f"{frame.id}_{index}_{uuid.uuid4().hex}.mp3")
                self.tts.synthesize(
                    line.line, clip, voice=voice,
                    speech_rate=plan.get("speed", 1.0), pitch_rate=plan.get("pitch", 1.0),
                    volume=plan.get("volume", 50), instructions=plan.get("instructions"),
                    model_override=plan.get("model_override"),
                    family_override=plan.get("family_override"),
                )
                if not os.path.isfile(clip) or not os.path.getsize(clip):
                    raise RuntimeError(f"TTS did not produce audio for 「{line.speaker}」")
                written.append(clip)
                line.audio_url = os.path.relpath(clip, "output")
                line.voice_id = voice
                # What this clip was actually read with, so rewriting the direction shows
                # as out of date. Recorded rather than compared against the line's own
                # current setting, which could never notice its own edit.
                line.instructions_used = plan.get("instructions") or None
                line.duration = _audio_duration(clip)
                if line.duration is None or not math.isfinite(line.duration) or line.duration <= 0:
                    raise ValueError("无法读取对白时长，不能安全装配配音")
                if not math.isfinite(line.start_seconds) or line.start_seconds < 0:
                    raise ValueError("对白起点无效，不能安全装配配音")
                line.scheduled_start_seconds = max(line.start_seconds, previous_end)
                previous_end = line.scheduled_start_seconds + line.duration
                # Reported, never trimmed: shortening a line is a creative decision.
                window = plan.get("window")
                window_end = line.start_seconds + window if window is not None else total_duration
                line.overruns_shot = previous_end > window_end + 0.05

            track = os.path.join(folder, f"{frame.id}_track_{uuid.uuid4().hex}.mp3")
            _assemble_dialogue_track([(clip, plans[i]["line"].scheduled_start_seconds) for i, clip in enumerate(written)],
                                     track, total_duration)
            written.append(track)
            frame.audio_url = os.path.relpath(track, "output")
            frame.audio_error = None
            frame.status = GenerationStatus.COMPLETED
            frame.dialogue_snapshot_text = _effective_dialogue_text(frame)
            frame.dialogue_voice_id = plans[0].get("voice")
            frame.dialogue_text_hash = _compute_lines_hash(plans)
        except Exception as error:
            for path in written:
                try:
                    os.unlink(path)
                except OSError:
                    pass
            logger.error("Per-line dialogue generation failed for frame %s: %s", frame.id, error)
            frame.status = GenerationStatus.FAILED
            frame.audio_error = f"配音生成失败：{error}"
        return frame

    def _mock_generate_dialogue(self, frame: StoryboardFrame, character: Character, text: str, speed: float, pitch: float, volume: int) -> StoryboardFrame:
        """Mock fallback — marks frame as FAILED instead of writing dummy bytes."""
        frame.status = GenerationStatus.FAILED
        frame.audio_error = "TTS service unavailable (mock mode)"
        logger.warning(f"Mock generate_dialogue called for frame {frame.id} — marking as FAILED")
        return frame

    def generate_sfx(self, frame: StoryboardFrame) -> StoryboardFrame:
        """Generates sound effects for the frame."""
        frame.status = GenerationStatus.PROCESSING
        
        try:
            logger.info(f"Generating SFX for: {frame.action_description}")
            
            output_path = os.path.join(self.output_dir, 'sfx', f"{frame.id}.wav")
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            self._write_test_sfx(output_path, frame.action_description, frame.video_url)
                
            # Store relative path for frontend serving
            rel_path = os.path.relpath(output_path, "output")
            frame.sfx_url = rel_path
            frame.sfx_fingerprint = _compute_sfx_fingerprint(frame.action_description, frame.video_url)
            frame.status = GenerationStatus.COMPLETED
            
        except Exception as e:
            logger.error(f"Failed to generate SFX for frame {frame.id}: {e}")
            frame.status = GenerationStatus.FAILED
            
        return frame

    def generate_sfx_preview(self, frame: StoryboardFrame) -> StoryboardFrame:
        """Generate a valid local-provider preview without replacing applied SFX."""
        output_path = os.path.join(self.output_dir, "sfx", f"{frame.id}_preview.wav")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        self._write_test_sfx(output_path, frame.action_description, frame.video_url)
        frame.preview_sfx_url = os.path.relpath(output_path, "output")
        frame.preview_sfx_fingerprint = _compute_sfx_fingerprint(frame.action_description, frame.video_url)
        return frame

    @staticmethod
    def _write_test_sfx(path: str, description: Optional[str], video_url: Optional[str]) -> None:
        """Write a valid deterministic WAV used by the local test provider."""
        import math
        import wave
        frequency = 330 + (sum(ord(char) for char in (description or "")) % 220)
        sample_rate = 16_000
        samples = int(sample_rate * 0.6)
        with wave.open(path, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            payload = bytearray()
            for index in range(samples):
                amplitude = int(8000 * math.sin(2 * math.pi * frequency * index / sample_rate) * (1 - index / samples))
                payload.extend(amplitude.to_bytes(2, byteorder="little", signed=True))
            wav.writeframes(bytes(payload))

    def generate_sfx_from_video(self, frame: StoryboardFrame) -> StoryboardFrame:
        """Generates SFX based on video content (Video-to-Audio)."""
        if not frame.video_url:
            return frame
            
        logger.info(f"Generating SFX from video for frame {frame.id}")
        # Mock V2A Logic
        time.sleep(1)
        
        output_path = os.path.join(self.output_dir, 'sfx', f"{frame.id}_v2a.wav")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        self._write_test_sfx(output_path, frame.action_description, frame.video_url)
        
        frame.sfx_url = os.path.relpath(output_path, "output")
        frame.sfx_fingerprint = _compute_sfx_fingerprint(frame.action_description, frame.video_url)
        return frame

    def generate_bgm(self, frame: StoryboardFrame) -> StoryboardFrame:
        """Reject BGM generation until a real music provider is configured.

        Writing placeholder bytes creates an apparently valid asset that
        cannot be published or decoded by FFmpeg, so callers must select a
        supplied preset or provide their own audio file instead.
        """
        raise RuntimeError(
            "BGM generation is not configured. Select an available preset or upload a real audio file."
        )
