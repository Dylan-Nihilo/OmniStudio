import json


def test_sync_derivation_persists_accepted_l3_supplements(tmp_path, monkeypatch):
    from src.apps.comic_gen import api

    monkeypatch.setattr(api, "_get_project_dir", lambda _project_id: tmp_path)

    api.sync_derivation(
        "project-1",
        api.SyncDerivationRequest(
            characters=[{"id": "mina", "name": "Mina"}],
            l3_supplements=[
                {"type": "character", "name": "Mina", "confidence": 0.92}
            ],
        ),
    )

    saved = json.loads((tmp_path / "derivation.json").read_text(encoding="utf-8"))
    assert saved["l3_supplements"] == [
        {"type": "character", "name": "Mina", "confidence": 0.92}
    ]
