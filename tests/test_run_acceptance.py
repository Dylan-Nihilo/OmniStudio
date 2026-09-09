import json
from pathlib import Path

import pytest


def test_acceptance_fixture_declares_readable_media_and_failure_task():
    from scripts.run_acceptance import load_acceptance_fixture

    fixture_path = Path(__file__).parent / "fixtures" / "acceptance_fixture.json"
    fixture = load_acceptance_fixture(fixture_path)

    assert len(fixture["media"]) >= 2
    assert {item["kind"] for item in fixture["media"]} >= {"image", "video"}
    assert any(task["status"] == "failed" for task in fixture["tasks"])


def test_acceptance_fixture_rejects_a_fixture_without_failure_evidence(tmp_path):
    from scripts.run_acceptance import FixtureValidationError, load_acceptance_fixture

    fixture_path = tmp_path / "fixture.json"
    payload = {
        "workspace": {"id": "w", "name": "Workspace"},
        "project": {"id": "p", "workspace_id": "w", "title": "Project"},
        "episodes": [{"id": "e", "project_id": "p"}],
        "chapters": [{"id": "c", "project_id": "p"}],
        "scenes": [{"id": "s", "project_id": "p"}],
        "characters": [{"id": "c1", "project_id": "p"}],
        "media": [
            {"id": "m", "kind": "image", "path": str(tmp_path / "image.svg")},
            {"id": "m2", "kind": "video", "path": str(tmp_path / "video.mp4")},
        ],
        "tasks": [{"id": "j", "status": "succeeded"}],
    }
    (tmp_path / "image.svg").write_bytes(b"<svg></svg>")
    (tmp_path / "video.mp4").write_bytes(b"\x00\x00\x00\x18ftypisom")
    fixture_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(FixtureValidationError, match="failed task"):
        load_acceptance_fixture(fixture_path)


def test_evidence_report_keeps_blocked_step_and_redacts_sensitive_events(tmp_path):
    from scripts.run_acceptance import AcceptanceReport, EvidenceRecorder

    report = AcceptanceReport(base_url="http://localhost:3008", browser="chromium")
    report.fixture_path = "tests/fixtures/acceptance_fixture.json"
    report.fixture_sha256 = "fixture-hash"
    recorder = EvidenceRecorder(report, tmp_path)
    recorder.record_event(
        "requestfailed",
        url="http://localhost:3008/api?token=secret",
        error="DASHSCOPE_API_KEY=do-not-leak",
        headers={"authorization": "Bearer header-secret", "x-request-id": "safe-id"},
    )
    recorder.add_step(
        "source",
        status="blocked",
        url="http://localhost:3008/#/workspace",
        title="Workspace",
        failure="Source navigation is not available",
    )

    paths = report.write()
    payload = json.loads(paths["run"].read_text(encoding="utf-8"))
    events = paths["events"].read_text(encoding="utf-8")

    assert payload["steps"][0]["status"] == "blocked"
    assert payload["steps"][0]["failure"]
    assert "do-not-leak" not in events
    assert "secret" not in events
    assert "header-secret" not in events
    assert "safe-id" in events
    assert paths["events"].exists()
    assert payload["fixture_path"] == "tests/fixtures/acceptance_fixture.json"
    assert payload["fixture_sha256"] == "fixture-hash"
    assert payload["event_count"] == 1


def test_cli_help_does_not_import_playwright(capsys):
    from scripts.run_acceptance import main

    assert main(["--help"]) == 0
    assert "--output" in capsys.readouterr().out


def test_login_redirect_is_detected_as_authentication_block():
    from scripts.run_acceptance import auth_page_is_resolved, is_login_page, is_login_url

    assert is_login_url("http://localhost:3008/#/login")
    assert not is_login_url("http://localhost:3008/#/workspace")
    assert is_login_page("http://localhost:3008/#/workspace", '<h1 id="login-title">故事，继续。</h1>')
    assert not is_login_page("http://localhost:3008/#/workspace", "<h1>工作区</h1>")
    assert auth_page_is_resolved('<h1 id="login-title">故事，继续。</h1>')
    assert auth_page_is_resolved('<aside data-app-sidebar></aside>')
    assert not auth_page_is_resolved("<p>正在验证登录状态...</p>")


def test_report_distinguishes_real_failures_from_blocked_steps():
    from scripts.run_acceptance import AcceptanceReport, acceptance_exit_code

    report = AcceptanceReport(base_url="http://localhost:3008", browser="chromium")
    report.add_step("source", status="blocked", failure="missing entry")
    assert report.has_failures
    assert report.only_blocked
    report.add_step("cast", status="failed", failure="provider error")
    assert report.has_failed_steps
    assert not report.only_blocked
    assert acceptance_exit_code(report, allow_blocked=True) == 1


def test_evidence_recorder_collects_request_and_success_response_summaries(tmp_path):
    from scripts.run_acceptance import AcceptanceReport, EvidenceRecorder

    class FakePage:
        def __init__(self):
            self.handlers = {}

        def on(self, event, handler):
            self.handlers[event] = handler

        def emit(self, event, value):
            self.handlers[event](value)

    class Request:
        url = "http://localhost:3008/api/projects"
        method = "GET"
        resource_type = "fetch"

    class Response:
        url = "http://localhost:3008/api/projects"
        status = 200
        request = Request()

    report = AcceptanceReport(base_url="http://localhost:3008", browser="chromium")
    recorder = EvidenceRecorder(report, tmp_path)
    page = FakePage()
    recorder.attach(page)
    page.emit("request", Request())
    page.emit("response", Response())

    assert {event["type"] for event in report.events} >= {"request", "response"}
    assert any(event.get("status") == 200 for event in report.events)


def test_fixture_state_builder_is_read_only_and_contains_failed_job():
    from scripts.run_acceptance import build_fixture_state, load_acceptance_fixture

    fixture = load_acceptance_fixture()
    state = build_fixture_state(fixture, "http://localhost:3008")

    assert state["project"]["title"] == fixture["project"]["title"]
    assert state["project"]["frames"]
    assert state["jobs"][0]["status"] == "failed"
    assert state["jobs"][0]["items"][0]["error_code"] == "FAKE_PROVIDER_FAILURE"
    assert state["write_policy"] == "reject"


def test_click_label_matches_numbered_pipeline_navigation_labels():
    from scripts.run_acceptance import _click_label

    class EmptyLocator:
        def count(self):
            return 0

    class Locator:
        def __init__(self):
            self.clicked = False

        def count(self):
            return 1

        @property
        def first(self):
            return self

        def click(self, timeout):
            self.clicked = True

    class Page:
        def __init__(self):
            self.locator = Locator()

        def get_by_role(self, role, name):
            if role == "row" and name.search("1. 脚本 · 3 个镜头"):
                return self.locator
            return EmptyLocator()

    page = Page()
    assert _click_label(page, ("Script", "脚本")) == "脚本"
    assert page.locator.clicked


def test_click_label_matches_global_navigation_count_badge():
    from scripts.run_acceptance import _click_label

    class Locator:
        clicked = False

        def count(self):
            return 1

        @property
        def first(self):
            return self

        def click(self, timeout):
            self.clicked = True

    class Page:
        def __init__(self):
            self.locator = Locator()

        def get_by_role(self, role, name):
            if role == "button" and name.search("任务中心 1"):
                return self.locator
            class EmptyLocator:
                def count(self):
                    return 0
            return EmptyLocator()

    page = Page()
    assert _click_label(page, ("Tasks", "任务中心")) == "任务中心"
    assert page.locator.clicked


def test_click_project_title_uses_visible_project_link():
    from scripts.run_acceptance import _click_project_title

    class Locator:
        clicked = False

        def count(self):
            return 1

        @property
        def first(self):
            return self

        def click(self, timeout):
            self.clicked = True

    class Page:
        def __init__(self):
            self.locator = Locator()

        def get_by_role(self, role, name):
            return self.locator if role == "link" and name.search("零点信号") else type("Empty", (), {"count": lambda self: 0})()

        def get_by_text(self, _name):
            return type("Empty", (), {"count": lambda self: 0})()

    page = Page()
    _click_project_title(page, "零点信号")
    assert page.locator.clicked


def test_main_chain_navigation_labels_match_rendered_pipeline_and_global_nav():
    from scripts.run_acceptance import MAIN_CHAIN_NAV_LABELS

    assert "脚本" in MAIN_CHAIN_NAV_LABELS["script"]
    assert "本集素材" in MAIN_CHAIN_NAV_LABELS["cast"]
    assert "分镜" in MAIN_CHAIN_NAV_LABELS["shot"]
    assert MAIN_CHAIN_NAV_LABELS["tasks"] == ("Tasks", "任务中心")
    assert "合成" in MAIN_CHAIN_NAV_LABELS["assembly"]


def test_fixture_routes_grant_ephemeral_edit_lease_without_mutating_state():
    from scripts.run_acceptance import (
        AcceptanceReport,
        build_fixture_state,
        install_fixture_routes,
        load_acceptance_fixture,
    )

    class FakePage:
        def route(self, _pattern, handler):
            self.handler = handler

    class Request:
        method = "POST"
        url = "http://localhost:3008/api-proxy/projects/project-acceptance/edit-lease"

    class Route:
        request = Request()

        def fulfill(self, *, status, content_type=None, body=None):
            self.status = status
            self.content_type = content_type
            self.body = body

    fixture = load_acceptance_fixture()
    state = build_fixture_state(fixture, "http://localhost:3008")
    report = AcceptanceReport(base_url="http://localhost:3008", browser="chromium")
    page = FakePage()
    install_fixture_routes(page, state, report)

    route = Route()
    page.handler(route)
    payload = json.loads(route.body)

    assert route.status == 200
    assert payload["script_id"] == "project-acceptance"
    assert payload["token"]
    assert not any(event["type"] == "fixture_write_blocked" for event in report.events)
