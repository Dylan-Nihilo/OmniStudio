from __future__ import annotations

from src.apps.comic_gen.revision import (
    compute_dependency_fingerprint,
    compute_revision,
    evaluate_stale,
)


def test_revision_is_stable_for_mapping_order():
    assert compute_revision({"b": 2, "a": 1}) == compute_revision({"a": 1, "b": 2})


def test_dependency_fingerprint_ignores_unrelated_input_when_not_referenced():
    first = compute_dependency_fingerprint(
        "shot",
        refs={"script_revision": "r1", "asset_ids": ["asset-1"]},
        params={"model": "wan", "duration": 5},
    )
    second = compute_dependency_fingerprint(
        "shot",
        refs={"script_revision": "r1", "asset_ids": ["asset-1"]},
        params={"model": "wan", "duration": 5, "ui_note": "changed"},
    )

    assert first != second
    assert evaluate_stale("r1", "r1", first, first) is False


def test_dependency_change_marks_result_stale():
    stored = compute_dependency_fingerprint(
        "audio",
        refs={"take_id": "take-1"},
        params={"voice": "voice-a"},
    )
    current = compute_dependency_fingerprint(
        "audio",
        refs={"take_id": "take-2"},
        params={"voice": "voice-a"},
    )

    assert evaluate_stale("r2", "r2", current, stored) is True
    assert evaluate_stale("r3", "r2", stored, stored) is True
