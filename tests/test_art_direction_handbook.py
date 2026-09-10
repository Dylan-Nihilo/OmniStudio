from tests.test_w2_project_api import api_client


def test_visual_handbook_markdown_round_trip_and_template_library(api_client):
    project = api_client.post("/projects?skip_analysis=true", json={"title": "Handbook", "text": "text"}).json()
    route = f"/projects/{project['id']}/art_direction/handbook"
    markdown = "# Neon Noir\n\n## Palette\nElectric cyan and magenta\n\n## Camera\nLong lenses, low angle"
    saved = api_client.put(route, json={"markdown": markdown, "title": "Neon Noir"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["visual_handbook_markdown"] == markdown
    exported = api_client.get(route)
    assert exported.status_code == 200
    assert exported.json()["markdown"] == markdown
    template = api_client.post(route + "/templates", json={"name": "Noir base"})
    assert template.status_code == 200, template.text
    assert template.json()["name"] == "Noir base"
    templates = api_client.get("/art_direction/handbook/templates")
    assert templates.status_code == 200
    assert any(item["name"] == "Noir base" for item in templates.json()["templates"])
