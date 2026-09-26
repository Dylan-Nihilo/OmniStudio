from urllib.parse import urlparse
import pytest
from pydantic import ValidationError


def test_job_item_contract_accepts_terminal_media_result():
    from src.apps.comic_gen.contracts import JobItemDTO, JobStatus, MediaRef

    item = JobItemDTO(
        id="item-1",
        job_id="job-1",
        workspace_id="workspace-1",
        kind="video",
        status=JobStatus.SUCCEEDED,
        progress=1.0,
        idempotency_key="workspace-1:video:shot-1:v1",
        media_refs=[MediaRef(id="media-1", kind="video", uri="media/video-1.mp4")],
    )

    assert item.status is JobStatus.SUCCEEDED
    assert item.media_refs[0].uri == "media/video-1.mp4"


def test_job_item_contract_rejects_progress_outside_range():
    from src.apps.comic_gen.contracts import JobItemDTO

    with pytest.raises(ValidationError):
        JobItemDTO(
            id="item-1",
            job_id="job-1",
            workspace_id="workspace-1",
            kind="asset",
            status="processing",
            progress=1.2,
            idempotency_key="key-1",
        )


def test_job_summary_exposes_partial_failure_without_hiding_item_states():
    from src.apps.comic_gen.contracts import JobItemDTO, JobStatus, summarize_job_items

    items = [
        JobItemDTO(id="1", job_id="j", workspace_id="w", kind="asset", status=JobStatus.SUCCEEDED, idempotency_key="1"),
        JobItemDTO(id="2", job_id="j", workspace_id="w", kind="asset", status=JobStatus.FAILED, idempotency_key="2"),
        JobItemDTO(id="3", job_id="j", workspace_id="w", kind="asset", status=JobStatus.CANCELED, idempotency_key="3"),
    ]

    summary = summarize_job_items(items)

    assert summary == {
        "total": 3,
        "succeeded": 1,
        "failed": 1,
        "canceled": 1,
        "skipped": 0,
        "status": "partially_succeeded",
    }


def test_api_error_contract_redacts_credentials_and_absolute_paths():
    from src.apps.comic_gen.contracts import APIErrorDTO, sanitize_error_text

    error = APIErrorDTO(
        code="PROVIDER_AUTH_FAILED",
        message=sanitize_error_text(
            "OPENAI_API_KEY=secret /Users/alice/OmniStudio/output/video.mp4"
        ),
        request_id="req-1",
    )

    assert "secret" not in error.message
    assert "OPENAI_API_KEY" not in error.message
    assert "/Users/alice" not in error.message


def test_a_transport_error_does_not_name_the_provider_it_failed_to_reach():
    """The HTTP stack names the host without a scheme, so the URL rule never caught it.

    Reported from production: six video generations failed on a read timeout and the error
    stored on each task — and shown to the creator — was
    `HTTPSConnectionPool(host='video.jojokey.com', port=443): Read timed out.` in full.
    """
    from src.apps.comic_gen.contracts import sanitize_error_text
    from src.utils.endpoints import PROVIDER_DEFAULTS

    cleaned = sanitize_error_text(
        "HTTPSConnectionPool(host='video.jojokey.com', port=443): Read timed out. (read timeout=120)"
    )
    assert "jojokey" not in cleaned.lower()
    # The useful part survives; only the counterparty is taken out.
    assert "Read timed out" in cleaned

    # Every provider in the registry is covered, not just the one that happened to break.
    for url in PROVIDER_DEFAULTS.values():
        host = urlparse(url).hostname
        if not host:
            continue
        assert host not in sanitize_error_text(f"connection to {host} refused"), host


def test_a_video_timeout_tells_the_creator_what_to_do_instead_of_naming_a_socket():
    from requests.exceptions import ReadTimeout

    from src.apps.comic_gen.pipeline import _describe_video_failure

    message = _describe_video_failure(ReadTimeout(
        "HTTPSConnectionPool(host='video.jojokey.com', port=443): Read timed out. (read timeout=120)"
    ))
    assert "jojokey" not in message.lower() and "HTTPSConnectionPool" not in message
    assert "超时" in message and "重试" in message
