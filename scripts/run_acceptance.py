"""Run the repeatable browser smoke for the Studio production chain.

The module keeps the report and fixture validation usable without Playwright so
CI can validate the acceptance contract on machines that do not have a browser
runtime installed.  The browser import is deliberately delayed until the
actual smoke is requested.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Mapping, Sequence
from urllib.parse import urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE = ROOT / "tests" / "fixtures" / "acceptance_fixture.json"
DEFAULT_URL = os.environ.get("OMNI_STUDIO_ACCEPTANCE_URL", "http://localhost:3008")
MAIN_CHAIN_NAV_LABELS = {
    "script": ("Script", "脚本", "剧本"),
    "cast": ("Cast", "本集素材", "Assets", "资产", "角色", "配音"),
    "shot": ("Storyboard", "分镜", "镜头"),
    "tasks": ("Tasks", "任务中心"),
    "assembly": ("Assembly", "合成", "Export", "导出"),
}
_SENSITIVE_KEY = re.compile(r"(?i)(api[_-]?key|access[_-]?token|authorization|cookie|password|secret|token)")
_KEY_VALUE_SECRET = re.compile(
    r"(?i)\b(api[_-]?key|access[_-]?token|authorization|cookie|password|secret|token)\s*[:=]\s*([^\s,;}\"']+)"
)
_ASSIGNMENT_SECRET = re.compile(
    r"(?i)(?:OPENAI_API_KEY|DASHSCOPE_API_KEY|MULEROUTER_API_KEY|API[_-]?KEY)\s*=\s*[^\s,;]+"
)
_BEARER = re.compile(r"(?i)(bearer\s+)[^\s,;]+")


class FixtureValidationError(ValueError):
    """Raised when a browser acceptance fixture cannot prove its own coverage."""


class AcceptanceBlocked(RuntimeError):
    """Raised for an intentionally recorded missing product capability."""


def is_login_url(url: str) -> bool:
    """Return whether the app redirected the browser to its login route."""

    normalized = str(url).rstrip("/").lower()
    return normalized.endswith("#/login") or normalized.endswith("/login")


def is_login_page(url: str, content: str) -> bool:
    """Detect delayed auth redirects using both route and stable login markers."""

    lowered = str(content).lower()
    return is_login_url(url) or 'id="login-title"' in lowered or "登录工作台" in content


def auth_page_is_resolved(content: str) -> bool:
    """Return whether the auth gate has rendered either login or app chrome."""

    lowered = str(content).lower()
    return 'id="login-title"' in lowered or "data-app-sidebar" in lowered or "登录工作台" in content


def redact(value: Any) -> str:
    """Return a short, credential-free representation for evidence files."""

    if isinstance(value, Mapping):
        safe: dict[str, Any] = {}
        for key, nested in value.items():
            key_text = str(key)
            safe[key_text] = "[credential redacted]" if _SENSITIVE_KEY.search(key_text) else redact(nested)
        return json.dumps(safe, ensure_ascii=False)
    if isinstance(value, (list, tuple, set)):
        return json.dumps([redact(item) for item in value], ensure_ascii=False)
    text = str(value if value is not None else "")
    text = _ASSIGNMENT_SECRET.sub("[credential redacted]", text)
    text = _BEARER.sub(r"\1[credential redacted]", text)
    text = _KEY_VALUE_SECRET.sub(r"\1=[credential redacted]", text)
    # Query parameters are useful for debugging, but credential values are not.
    try:
        parsed = urlsplit(text)
    except ValueError:
        parsed = None
    if parsed and parsed.scheme and parsed.netloc:
        query = re.sub(
            r"(?i)(^|&)(token|access_token|api_key|key|password|secret)=[^&]*",
            r"\1\2=[redacted]",
            parsed.query,
        )
        text = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))
    # Avoid dumping a complete HTML document or a large provider response.
    return text[:1200]


def _require_non_empty_list(payload: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
    value = payload.get(key)
    if not isinstance(value, list) or not value:
        raise FixtureValidationError(f"fixture field '{key}' must be a non-empty list")
    if not all(isinstance(item, Mapping) for item in value):
        raise FixtureValidationError(f"fixture field '{key}' must contain objects")
    return list(value)


def load_acceptance_fixture(path: str | Path = DEFAULT_FIXTURE) -> dict[str, Any]:
    """Load and validate the relationship and failure evidence used by smoke."""

    fixture_path = Path(path)
    try:
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FixtureValidationError(f"cannot read fixture {fixture_path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise FixtureValidationError("fixture root must be an object")
    for key in ("workspace", "project"):
        if not isinstance(payload.get(key), Mapping):
            raise FixtureValidationError(f"fixture field '{key}' must be an object")
    for key in ("episodes", "chapters", "scenes", "characters"):
        _require_non_empty_list(payload, key)

    media = _require_non_empty_list(payload, "media")
    if len(media) < 2:
        raise FixtureValidationError("fixture must declare at least two media entries")
    for item in media:
        if not item.get("id") or not item.get("kind"):
            raise FixtureValidationError("each media entry needs id and kind")
        if not item.get("path") and not item.get("url"):
            raise FixtureValidationError("each media entry needs path or url")
        if item.get("path"):
            media_path = Path(str(item["path"]))
            if not media_path.is_absolute():
                media_path = ROOT / media_path
            try:
                header = media_path.read_bytes()[:16]
            except OSError as exc:
                raise FixtureValidationError(f"media file is not readable: {item['path']}") from exc
            if not header:
                raise FixtureValidationError(f"media file is empty: {item['path']}")
            kind = str(item["kind"]).lower()
            signatures = {
                "image": (b"<svg", b"\x89PNG", b"\xff\xd8\xff"),
                "video": (b"ftyp", b"\x1a\x45\xdf\xa3"),
                "audio": (b"RIFF", b"ID3", b"OggS"),
            }
            expected = signatures.get(kind)
            if expected and not any(signature in header for signature in expected):
                raise FixtureValidationError(f"media file does not match kind '{kind}': {item['path']}")

    tasks = _require_non_empty_list(payload, "tasks")
    if not any(str(item.get("status", "")).lower() == "failed" for item in tasks):
        raise FixtureValidationError("fixture must include a failed task")
    return payload


def build_fixture_state(fixture: Mapping[str, Any], base_url: str) -> dict[str, Any]:
    """Build an in-memory, read-only API state for browser smoke.

    The state intentionally mirrors only the response shapes needed by the
    existing Studio pages. It never writes to ``output/`` or the application
    database; all mutation requests are rejected by ``install_fixture_routes``.
    """

    base = base_url.rstrip("/")
    media_by_kind = {str(item.get("kind")): item for item in fixture.get("media", [])}

    def media_url(kind: str) -> str:
        item = media_by_kind.get(kind) or next(iter(fixture.get("media", [])), {})
        url = str(item.get("url") or "")
        return f"{base}{url}" if url.startswith("/") else url

    image_url = media_url("image")
    video_url = media_url("video")
    audio_url = media_url("audio")
    project_id = str(fixture["project"]["id"])
    workspace_id = str(fixture["workspace"]["id"])
    now = int(time.time())

    characters = [
        {
            **item,
            "description": item.get("name", "") + " acceptance character",
            "image_url": image_url,
            "source": "episode",
        }
        for item in fixture["characters"]
    ]
    scenes = [
        {
            **item,
            "description": item.get("name", "") + " acceptance scene",
            "image_url": image_url,
            "source": "episode",
        }
        for item in fixture["scenes"]
    ]
    frames = []
    for index, scene in enumerate(scenes[:3], start=1):
        frame_id = f"frame-acceptance-{index:02d}"
        frames.append(
            {
                "id": frame_id,
                "scene_id": scene["id"],
                "shot_number": index,
                "description": f"Acceptance shot {index}",
                "prompt": f"{scene.get('name', 'scene')} at midnight",
                "image_url": image_url,
                "rendered_image_url": image_url,
                "video_url": video_url if index == 1 else None,
                "audio_url": audio_url if index == 1 else None,
                "status": "completed" if index == 1 else "pending",
                "selected_video_id": f"take-{index}" if index == 1 else None,
                "video_candidates": [
                    {
                        "id": f"take-{index}",
                        "video_url": video_url,
                        "status": "completed",
                        "created_at": now,
                    }
                ]
                if index == 1
                else [],
            }
        )

    project = {
        "id": project_id,
        "workspace_id": workspace_id,
        "title": fixture["project"]["title"],
        "original_text": "Deterministic acceptance script",
        "characters": characters,
        "scenes": scenes,
        "props": [],
        "frames": frames,
        "video_tasks": [],
        "status": "completed",
        "created_at": now,
        "updated_at": now,
        "workflow_mode": "r2v",
        "default_generation_mode": "r2v",
        "aspect_ratio": "9:16",
        "art_direction": {"style": "Acceptance fixture style", "prompt": "deterministic"},
    }

    failed_task = next((task for task in fixture["tasks"] if task.get("status") == "failed"), fixture["tasks"][0])
    job_id = str(failed_task.get("id") or "job-acceptance-failed")
    item_id = f"{job_id}-item"
    item = {
        "id": item_id,
        "job_id": job_id,
        "workspace_id": workspace_id,
        "project_id": project_id,
        "episode_id": fixture["episodes"][0].get("id"),
        "kind": failed_task.get("kind", "video_generation"),
        "status": "failed",
        "progress": 0.5,
        "idempotency_key": f"acceptance:{job_id}",
        "media_refs": [],
        "error_code": failed_task.get("error_code", "FAKE_PROVIDER_FAILURE"),
        "error_message": failed_task.get("error_message", "Deterministic acceptance failure"),
        "payload": {"frame_id": frames[0]["id"] if frames else None},
        "created_at": now,
        "updated_at": now,
    }
    job = {
        "id": job_id,
        "workspace_id": workspace_id,
        "project_id": project_id,
        "episode_id": fixture["episodes"][0].get("id"),
        "kind": failed_task.get("kind", "video_generation"),
        "status": "failed",
        "total": 1,
        "succeeded": 0,
        "failed": 1,
        "canceled": 0,
        "skipped": 0,
        "items": [item],
        "created_at": now,
        "updated_at": now,
    }
    source_id = "source-acceptance"
    source_chapters = [
        {
            "id": chapter["id"],
            "source_document_id": source_id,
            "chapter_number": index,
            "title": chapter["title"],
            "current_revision_id": f"revision-{chapter['id']}",
            "revision_count": 1,
            "current_revision": {
                "id": f"revision-{chapter['id']}",
                "source_document_id": source_id,
                "chapter_id": chapter["id"],
                "revision_number": 1,
                "content": f"{chapter['title']} 的验收正文。",
                "content_sha256": "a" * 64,
                "created_by_user_id": "acceptance-user",
                "metadata": {},
                "created_at": now,
            },
            "created_at": now,
            "updated_at": now,
        }
        for index, chapter in enumerate(fixture["chapters"], start=1)
    ]
    source = {
        "id": source_id,
        "workspace_id": workspace_id,
        "title": "零点信号原始资料",
        "source_type": "txt",
        "original_filename": "acceptance.txt",
        "encoding": "utf-8",
        "summary": "三章固定验收来源",
        "metadata": {},
        "imported_at": now,
        "chapter_count": len(source_chapters),
        "linked_episode_count": len(fixture["episodes"]),
        "created_at": now,
        "updated_at": now,
        "chapters": source_chapters,
        "episodes": [
            {"id": episode["id"], "project_id": project_id, "title": episode["title"], "episode_number": episode.get("number"), "status": "draft", "linked_at": now}
            for episode in fixture["episodes"]
        ],
    }
    return {
        "user": {"id": "acceptance-user", "username": "acceptance", "display_name": "Acceptance User", "email": "acceptance@example.test"},
        "workspace": {"id": workspace_id, "name": fixture["workspace"]["name"], "slug": "acceptance", "role": "owner"},
        "project": project,
        "source": source,
        "jobs": [job],
        "write_policy": "reject",
    }


def install_fixture_routes(page: Any, state: Mapping[str, Any], report: AcceptanceReport) -> None:
    """Intercept API reads with fixture state and reject every API mutation."""

    project = state["project"]
    source = state.get("source")
    jobs = list(state["jobs"])

    def json_response(route: Any, payload: Any, status: int = 200) -> None:
        route.fulfill(status=status, content_type="application/json", body=json.dumps(payload, ensure_ascii=False))

    def resolve(path: str) -> Any:
        clean = path.removeprefix("/api-proxy").rstrip("/") or "/"
        if clean == "/auth/setup-status":
            return {"initialized": True, "setup_allowed": False}
        if clean == "/auth/me":
            return {"user": state["user"], "workspace": state["workspace"], "workspaces": [state["workspace"]]}
        if clean == "/auth/legacy-claim/status":
            return {"summary": {"projects": 0, "series": 0, "media": 0, "conflicts": 0}, "batch": None}
        if clean == "/config/env":
            return {"DASHSCOPE_API_KEY": "configured-preview-only"}
        if clean == "/projects":
            return [project]
        if clean == f"/projects/{project['id']}":
            return project
        if clean == "/series":
            return []
        if clean == "/sources":
            summary = {key: value for key, value in source.items() if key not in {"chapters", "episodes"}} if source else None
            return {"items": [summary] if summary else [], "total": 1 if summary else 0}
        if source and clean == f"/sources/{source['id']}":
            return source
        if source and clean == f"/sources/{source['id']}/chapters":
            return {"items": source["chapters"], "total": len(source["chapters"]), "page": 1, "page_size": 20}
        if source and clean == f"/sources/{source['id']}/episodes":
            return {"items": source["episodes"], "total": len(source["episodes"])}
        if clean.startswith("/director-plans/resolve/"):
            episode_id = clean.rsplit("/", 1)[-1]
            plan = {"tempo": "balanced", "composition": "natural", "lens": "35mm", "blocking": "clear subject separation", "lighting": "motivated soft light", "transition": "cut", "sound": "diegetic room tone", "continuity_rules": []}
            return {"episode_id": episode_id, "shot_id": None, "plan": plan, "source_chain": {key: "system" for key in plan}, "layers": []}
        if clean == f"/projects/{project['id']}/document":
            return {"project_id": project["id"], "content": {"type": "doc", "content": [{"type": "action", "content": [{"type": "text", "text": "Deterministic acceptance script"}]}]}, "revision": "acceptance-document", "stale": False, "source_dependencies": [], "stale_targets": [], "updated_at": time.time()}
        if clean.startswith("/series/") and clean.endswith("/episodes"):
            return []
        if clean == "/tasks":
            return {"items": jobs, "page": 1, "page_size": 10, "total": len(jobs)}
        if clean == "/tasks/summary":
            return {"pending": 0, "processing": 0, "running": 0, "succeeded": 0, "failed": 1, "canceled": 0, "skipped": 0, "total": len(jobs)}
        if clean.startswith("/tasks/"):
            job_id = clean.rsplit("/", 1)[-1]
            job = next((value for value in jobs if value["id"] == job_id), jobs[0])
            return {"job": job, "events": [{"id": "event-1", "item_id": job["items"][0]["id"], "to_status": "failed", "error_code": job["items"][0]["error_code"], "created_at": job["updated_at"]}]}
        if clean == "/prompt_defaults":
            return {}
        if clean == "/art_direction/presets":
            return []
        if clean.startswith(f"/projects/{project['id']}/"):
            return project
        return None

    def handle(route: Any) -> None:
        request = route.request
        method = str(request.method).upper()
        path = urlsplit(request.url).path
        clean = path.removeprefix("/api-proxy").rstrip("/") or "/"
        lease_path = f"/projects/{project['id']}/edit-lease"
        # The lease is an ephemeral coordination handshake, not a fixture data
        # mutation. Granting it keeps the real UI interactive while all other
        # writes remain rejected below.
        if clean == lease_path and method in {"POST", "PATCH"}:
            body = getattr(request, "post_data_json", None)
            client_instance_id = "acceptance-client"
            if isinstance(body, Mapping) and body.get("client_instance_id"):
                client_instance_id = str(body["client_instance_id"])
            json_response(
                route,
                {
                    "script_id": project["id"],
                    "holder_user_id": state["user"]["id"],
                    "holder_display_name": state["user"]["display_name"],
                    "client_instance_id": client_instance_id,
                    "expires_at": int(time.time()) + 90,
                    "revision": "acceptance-revision-1",
                    "token": "acceptance-edit-lease",
                },
            )
            return
        if clean == lease_path and method == "DELETE":
            route.fulfill(status=204, body="")
            return
        if method not in {"GET", "HEAD", "OPTIONS"} and ("/api-proxy/" in path or path.startswith("/auth/") or path.startswith("/tasks") or path.startswith("/projects")):
            report.record_event("fixture_write_blocked", url=request.url, method=method)
            json_response(route, {"detail": "Read-only acceptance fixture"}, status=403)
            return
        if method not in {"GET", "HEAD", "OPTIONS"}:
            route.continue_()
            return
        payload = resolve(path)
        if payload is None:
            route.continue_()
            return
        json_response(route, payload)

    page.route("**/*", handle)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class AcceptanceReport:
    """Serializable run summary shared by unit tests and the browser harness."""

    base_url: str
    browser: str
    run_id: str = field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    started_at: str = field(default_factory=_now)
    steps: list[dict[str, Any]] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    output_dir: Path | None = None
    fixture_path: str | None = None
    fixture_sha256: str | None = None

    def add_step(
        self,
        name: str,
        *,
        status: str,
        url: str = "",
        title: str = "",
        screenshot: str | None = None,
        dom: str | None = None,
        failure: str | None = None,
    ) -> dict[str, Any]:
        if status not in {"passed", "failed", "blocked"}:
            raise ValueError(f"unsupported acceptance status: {status}")
        item = {
            "name": name,
            "status": status,
            "url": redact(url),
            "title": redact(title),
            "screenshot": screenshot,
            "dom_excerpt": redact(dom or ""),
            "failure": redact(failure) if failure else None,
            "recorded_at": _now(),
        }
        self.steps.append(item)
        return item

    def record_event(self, event_type: str, **details: Any) -> None:
        event = {"type": event_type, "recorded_at": _now()}
        for key, value in details.items():
            event[key] = redact(value) if key in {"url", "error", "message", "text", "headers"} else value
        self.events.append(event)

    def write(self, output_dir: str | Path | None = None) -> dict[str, Path]:
        target = Path(output_dir or self.output_dir or (ROOT / ".artifacts" / "acceptance" / self.run_id))
        target.mkdir(parents=True, exist_ok=True)
        self.output_dir = target
        run_path = target / "run.json"
        events_path = target / "events.jsonl"
        payload = {
            "run_id": self.run_id,
            "base_url": redact(self.base_url),
            "browser": self.browser,
            "started_at": self.started_at,
            "finished_at": _now(),
            "fixture_path": self.fixture_path,
            "fixture_sha256": self.fixture_sha256,
            "event_count": len(self.events),
            "steps": self.steps,
            "step_counts": {
                status: sum(step["status"] == status for step in self.steps)
                for status in ("passed", "failed", "blocked")
            },
        }
        run_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        with events_path.open("w", encoding="utf-8") as handle:
            for event in self.events:
                handle.write(json.dumps(event, ensure_ascii=False) + "\n")
        return {"run": run_path, "events": events_path}

    @property
    def has_failures(self) -> bool:
        return any(step["status"] in {"failed", "blocked"} for step in self.steps)

    @property
    def has_failed_steps(self) -> bool:
        return any(step["status"] == "failed" for step in self.steps)

    @property
    def only_blocked(self) -> bool:
        return bool(self.steps) and not self.has_failed_steps and any(step["status"] == "blocked" for step in self.steps)


def acceptance_exit_code(report: AcceptanceReport, *, allow_blocked: bool = False) -> int:
    """Map report status to a CLI code without masking real failures."""

    if report.has_failed_steps:
        return 1
    if report.only_blocked and not allow_blocked:
        return 1
    return 0


class EvidenceRecorder:
    """Collect browser events and one DOM/screenshot pair per step."""

    def __init__(self, report: AcceptanceReport, output_dir: str | Path | None = None):
        self.report = report
        self.output_dir = Path(output_dir or report.output_dir or ROOT / ".artifacts" / "acceptance" / report.run_id)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._step_number = 0

    def record_event(self, event_type: str, **details: Any) -> None:
        self.report.record_event(event_type, **details)

    def add_step(self, name: str, **kwargs: Any) -> dict[str, Any]:
        """Record a synthetic step when no live page is available."""

        return self.report.add_step(name, **kwargs)

    def attach(self, page: Any) -> None:
        """Attach only stable Playwright listeners; fake pages can implement ``on`` too."""

        if not hasattr(page, "on"):
            return
        page.on("console", lambda message: self._console(message))
        page.on("pageerror", lambda error: self.record_event("pageerror", error=str(error)))
        page.on("request", lambda request: self._request(request))
        page.on("requestfailed", lambda request: self._request_failed(request))
        page.on("response", lambda response: self._response(response))

    def _console(self, message: Any) -> None:
        text = getattr(message, "text", None)
        if callable(text):
            text = text()
        self.record_event("console", level=getattr(message, "type", "log"), text=text or str(message))

    def _request_failed(self, request: Any) -> None:
        url = getattr(request, "url", "")
        if callable(url):
            url = url()
        failure = getattr(request, "failure", None)
        if callable(failure):
            failure = failure()
        self.record_event("requestfailed", url=url, error=failure or "request failed")

    def _request(self, request: Any) -> None:
        url = getattr(request, "url", "")
        if callable(url):
            url = url()
        method = getattr(request, "method", "GET")
        if callable(method):
            method = method()
        resource_type = getattr(request, "resource_type", "")
        if callable(resource_type):
            resource_type = resource_type()
        self.record_event("request", url=url, method=method, resource_type=resource_type)

    def _response(self, response: Any) -> None:
        url = getattr(response, "url", "")
        if callable(url):
            url = url()
        status = getattr(response, "status", None)
        if callable(status):
            status = status()
        request = getattr(response, "request", None)
        method = getattr(request, "method", "GET") if request is not None else "GET"
        if callable(method):
            method = method()
        self.record_event("response", url=url, status=status, method=method)

    @staticmethod
    def _read_page(page: Any, method: str, default: Any = "") -> Any:
        try:
            value = getattr(page, method)
            return value() if callable(value) else value
        except Exception as exc:  # pragma: no cover - browser implementation detail
            return default if default != "" else f"<{method} unavailable: {exc}>"

    def capture_step(
        self,
        name: str,
        page: Any,
        *,
        status: str,
        failure: str | None = None,
    ) -> dict[str, Any]:
        self._step_number += 1
        stem = f"{self._step_number:02d}-{re.sub(r'[^a-zA-Z0-9_-]+', '-', name).strip('-').lower()}"
        screenshot_path = self.output_dir / f"{stem}.png"
        dom_path = self.output_dir / f"{stem}.html"
        url = self._read_page(page, "url", "")
        title = self._read_page(page, "title", "")
        dom = self._read_page(page, "content", "")
        if not isinstance(dom, str):
            dom = str(dom)
        try:
            screenshot = getattr(page, "screenshot")
            screenshot(path=str(screenshot_path), full_page=True)
        except Exception as exc:  # pragma: no cover - depends on browser lifecycle
            self.record_event("screenshot_failed", error=str(exc), step=name)
            screenshot_path = None
        try:
            dom_path.write_text(dom[:200_000], encoding="utf-8")
        except OSError as exc:  # pragma: no cover - filesystem failure
            self.record_event("dom_write_failed", error=str(exc), step=name)
            dom_path = None
        return self.report.add_step(
            name,
            status=status,
            url=url,
            title=title,
            screenshot=str(screenshot_path) if screenshot_path else None,
            dom=dom,
            failure=failure,
        )

    @contextlib.contextmanager
    def step(self, name: str, page: Any) -> Iterator[None]:
        """Record evidence even when the action raises, then re-raise it."""

        try:
            yield
        except AcceptanceBlocked as exc:
            self.capture_step(name, page, status="blocked", failure=str(exc))
            raise
        except Exception as exc:
            self.capture_step(name, page, status="failed", failure=str(exc))
            raise
        else:
            self.capture_step(name, page, status="passed")


def _locator_count(locator: Any) -> int:
    try:
        return int(locator.count())
    except Exception:
        return 0


def _click_label(page: Any, labels: Sequence[str], *, timeout: int = 5000) -> str:
    """Click a visible role locator by one of the localized labels."""

    for label in labels:
        pattern = re.compile(
            rf"^(?:\d+\.\s*)?{re.escape(label)}(?:\s*[·:].*|\s+\d+)?$",
            re.IGNORECASE,
        )
        for role in ("link", "button", "tab", "row"):
            try:
                locator = page.get_by_role(role, name=pattern)
                if _locator_count(locator):
                    locator.first.click(timeout=timeout)
                    return label
            except Exception:
                continue
    raise AcceptanceBlocked(f"navigation target is not available: {' / '.join(labels)}")


def _click_project_title(page: Any, project_title: str, *, timeout: int = 5000) -> None:
    """Click the fixture project from a workspace-like page."""

    candidates = page.get_by_role("link", name=re.compile(re.escape(project_title), re.IGNORECASE))
    if not _locator_count(candidates):
        candidates = page.get_by_text(re.compile(re.escape(project_title), re.IGNORECASE))
    if not _locator_count(candidates):
        raise AcceptanceBlocked(f"fixture project is not visible: {project_title}")
    candidates.first.click(timeout=timeout)


def _wait_after_click(page: Any) -> None:
    try:
        page.wait_for_load_state("domcontentloaded", timeout=3000)
    except Exception:
        pass
    try:
        page.wait_for_timeout(1000)
    except Exception:
        pass


def _wait_for_auth_resolution(page: Any) -> None:
    """Allow the async auth bootstrap to settle before classifying the page."""

    wait_for_function = getattr(page, "wait_for_function", None)
    if callable(wait_for_function):
        try:
            wait_for_function(
                """() => Boolean(document.querySelector('#login-title, [data-app-sidebar]')) ||
                    document.body?.innerText?.includes('登录工作台')""",
                timeout=5000,
            )
            return
        except Exception:
            pass
    try:
        page.wait_for_timeout(1000)
    except Exception:
        pass


def run_browser_flow(config: argparse.Namespace, report: AcceptanceReport) -> AcceptanceReport:
    """Execute the click-only smoke. Playwright is imported only here."""

    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "Playwright is required for browser smoke. Install the project e2e dependency "
            "or run the in-app browser manually; report contract checks do not need it."
        ) from exc

    recorder = EvidenceRecorder(report, config.output)
    with sync_playwright() as playwright:
        browser_type = getattr(playwright, config.browser)
        browser = browser_type.launch(headless=not config.headed)
        page = browser.new_page(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
        recorder.attach(page)
        state = build_fixture_state(config.fixture, config.base_url)
        report.record_event(
            "fixture_media",
            media=[{"id": item.get("id"), "kind": item.get("kind"), "path": item.get("path"), "url": item.get("url")} for item in config.fixture.get("media", [])],
        )
        report.record_event(
            "fixture_task_states",
            states=[{"id": item.get("id"), "status": item.get("status"), "retryable": item.get("status") == "failed", "cancelable": item.get("status") in {"pending", "processing"}} for item in config.fixture.get("tasks", [])],
        )
        install_fixture_routes(page, state, report)
        try:
            page.goto(f"{config.base_url.rstrip('/')}/#/workspace", wait_until="domcontentloaded")
            _wait_after_click(page)
            _wait_for_auth_resolution(page)
            current_url = str(recorder._read_page(page, "url", ""))
            current_content = str(recorder._read_page(page, "content", ""))
            if is_login_page(current_url, current_content):
                try:
                    with recorder.step("login", page):
                        if not str(recorder._read_page(page, "content", "")).strip():
                            raise RuntimeError("login rendered an empty document")
                except Exception:
                    pass
                recorder.capture_step("workspace", page, status="blocked", failure="authentication is required")
                for name in ("source", "project", "script", "cast", "shot", "tasks", "assembly"):
                    recorder.capture_step(name, page, status="blocked", failure="authentication is required")
                return report
            else:
                with recorder.step("workspace", page):
                    if not str(recorder._read_page(page, "content", "")).strip():
                        raise RuntimeError("workspace rendered an empty document")

            # Source is intentionally recorded before the project pipeline: its
            # missing entry is a product gap, not a reason to skip the rest.
            try:
                with recorder.step("source", page):
                    _click_label(page, ("Source", "来源资料", "来源", "素材源"))
                    _wait_after_click(page)
            except AcceptanceBlocked:
                pass

            if "sources" in str(recorder._read_page(page, "url", "")) or "来源资料" in str(recorder._read_page(page, "content", "")):
                try:
                    _click_label(page, ("Workspace", "工作区", "Omni Studio · 工作区"))
                    _wait_after_click(page)
                except AcceptanceBlocked:
                    pass

            project_title = str(config.fixture.get("project", {}).get("title", ""))
            try:
                with recorder.step("project", page):
                    _click_project_title(page, project_title)
                    _wait_after_click(page)
            except AcceptanceBlocked:
                # Without a project there is no safe click path for pipeline
                # steps; retain explicit blocked evidence for each one.
                for name in ("script", "cast", "shot", "tasks", "assembly"):
                    recorder.capture_step(name, page, status="blocked", failure="project navigation unavailable")
                return report

            for name in ("script", "cast", "shot"):
                labels = MAIN_CHAIN_NAV_LABELS[name]
                try:
                    with recorder.step(name, page):
                        _click_label(page, labels)
                        _wait_after_click(page)
                except AcceptanceBlocked:
                    pass

            # Task Center is global and can be clicked from the project shell.
            for name in ("tasks", "assembly"):
                labels = MAIN_CHAIN_NAV_LABELS[name]
                try:
                    with recorder.step(name, page):
                        try:
                            _click_label(page, labels)
                        except AcceptanceBlocked:
                            if name != "assembly":
                                raise
                            # Task Center is a global page. Return through the
                            # visible workspace and project controls before
                            # clicking the pipeline's Assembly step.
                            _click_label(page, ("Workspace", "工作区", "Omni Studio · 工作区"))
                            _wait_after_click(page)
                            _click_project_title(page, project_title)
                            _wait_after_click(page)
                            _click_label(page, labels)
                        _wait_after_click(page)
                except AcceptanceBlocked:
                    pass
        finally:
            report.write(config.output)
            browser.close()
    return report


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Omni Studio main-chain browser acceptance smoke.")
    parser.add_argument("--url", "--base-url", dest="base_url", default=DEFAULT_URL, help="Frontend URL (default: %(default)s)")
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE, help="Acceptance fixture JSON")
    parser.add_argument("--output", type=Path, help="Evidence directory (default: .artifacts/acceptance/<run>)")
    parser.add_argument("--browser", choices=("chromium", "firefox", "webkit"), default="chromium")
    parser.add_argument("--headed", action="store_true", help="Show the browser window")
    parser.add_argument("--allow-blocked", action="store_true", help="Return success when only blocked steps remain")
    parser.add_argument("--validate-only", action="store_true", help="Validate the fixture and write a report without launching a browser")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        # Keep ``main(["--help"])`` usable from unit tests while preserving
        # argparse's normal exit behavior for the command-line entry point.
        return int(exc.code or 0)
    output = args.output or ROOT / ".artifacts" / "acceptance" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    report = AcceptanceReport(base_url=args.base_url, browser=args.browser, output_dir=output)
    fixture_path: Path | None = None
    try:
        fixture_path = Path(args.fixture)
        fixture_path = fixture_path if fixture_path.is_absolute() else ROOT / fixture_path
        fixture_path = fixture_path.resolve()
        fixture_data = load_acceptance_fixture(fixture_path)
        report.fixture_path = str(fixture_path.relative_to(ROOT)) if fixture_path.is_relative_to(ROOT) else str(fixture_path)
        report.fixture_sha256 = hashlib.sha256(fixture_path.read_bytes()).hexdigest()
        config = args
        config.fixture = fixture_data
        if args.validate_only:
            report.add_step("fixture", status="passed", url=str(fixture_path), title="fixture validated")
            report.write(output)
            print(f"PASS: fixture validated; evidence={output}")
            return 0
        run_browser_flow(config, report)
    except FixtureValidationError as exc:
        report.add_step("fixture", status="failed", url=str(fixture_path or ""), title="fixture validation", failure=str(exc))
        report.write(output)
        print(f"FAIL: {exc}; evidence={output}", file=sys.stderr)
        return 2
    except Exception as exc:
        report.add_step("browser", status="failed", url=args.base_url, title="browser smoke", failure=str(exc))
        report.write(output)
        print(f"FAIL: {exc}; evidence={output}", file=sys.stderr)
        return 3
    finally:
        # Keep the fixture hash in a small sidecar for traceability without
        # copying fixture contents into logs.
        try:
            if fixture_path is not None:
                fixture_hash = hashlib.sha256(fixture_path.read_bytes()).hexdigest()
                (Path(output) / "fixture.sha256").write_text(fixture_hash + "\n", encoding="ascii")
        except (OSError, AttributeError, TypeError):
            pass
    report.write(output)
    if acceptance_exit_code(report, allow_blocked=args.allow_blocked):
        print(f"FAIL: acceptance has failed or blocked steps; evidence={output}", file=sys.stderr)
        return 1
    print(f"PASS: acceptance smoke complete; evidence={output}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
