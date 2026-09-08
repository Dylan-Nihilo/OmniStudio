import json
from pathlib import Path


def test_main_chain_fixture_has_required_relationships():
    from src.apps.comic_gen.contracts import AcceptanceFixture

    fixture_path = Path(__file__).parent / "fixtures" / "acceptance_fixture.json"
    fixture = AcceptanceFixture.model_validate(json.loads(fixture_path.read_text(encoding="utf-8")))

    assert fixture.workspace.id
    assert len(fixture.episodes) == 2
    assert len(fixture.chapters) == 3
    assert len(fixture.scenes) == 5
    assert len(fixture.characters) == 2
    assert all(chapter.project_id == fixture.project.id for chapter in fixture.chapters)
    assert all(episode.project_id == fixture.project.id for episode in fixture.episodes)
