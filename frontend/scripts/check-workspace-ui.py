"""Browser acceptance check; all account/project responses are local test data."""
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3019/#/workspace"
root = Path(__file__).resolve().parents[2]
output = root / "docs/agents/context/workspace-overview"
output.mkdir(parents=True, exist_ok=True)
workspace = {"id": "preview", "name": "创作工作室", "slug": "preview", "role": "owner"}
other_workspace = {**workspace, "id": "empty", "name": "空白工作区"}
user = {"id": "preview-user", "username": "preview-artist", "display_name": "Dylan", "email": "preview@example.test"}
origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
covers = ["/auth/hero-night-signal.png",
          "/assets/styles/japanese_anime__modern_cel_anime__rooftop_sunset_v2__landscape.png",
          "/assets/styles/japanese_anime__80s_90s_urban_anime__showa_beauty_sports_car__square.png",
          "/assets/styles/japanese_anime__warm_hand_drawn_anime__forest_creature_valley_v2__landscape.png"]
projects = []
for index, title in enumerate(("夜航信号", "雨后城市", "远方的回声", "楼梯间的风")):
    frames = [{"id": f"shot-{n}", "image_url": origin + covers[index] if n < 12 else None, "video_url": "/preview.mp4" if n < 7 else None, "audio_url": "/preview.wav" if n < 3 else None} for n in range(18)]
    projects.append({"id": f"project-{index}", "title": title, "original_text": "A story for browser layout verification.", "frames": frames, "characters": [], "scenes": [], "props": [], "created_at": 1788500000-index*3600, "updated_at": 1788500000-index*3600, "video_tasks": [{"id": "job", "status": "processing", "frame_id": "shot-8"}] if index == 0 else []})
state = {"mode": "populated"}
unexpected_writes = []

def respond(route):
    path = urlparse(route.request.url).path.removeprefix("/api-proxy")
    if route.request.method not in ("GET", "HEAD", "OPTIONS"):
        unexpected_writes.append(path)
        route.fulfill(status=403, json={"detail": "Read-only UI verification"})
        return
    empty = state["mode"] == "empty" or route.request.headers.get("x-workspace-id") == "empty"
    if path == "/auth/setup-status": data = {"initialized": True, "setup_allowed": False}
    elif path == "/auth/me": data = {"user": user, "workspace": workspace, "workspaces": [workspace, other_workspace]}
    elif path == "/auth/legacy-claim/status": data = {"summary": {"projects": 0, "series": 0, "media": 0, "conflicts": 0}, "batch": None}
    elif path == "/config/env": data = {"DASHSCOPE_API_KEY": "configured-preview-only"}
    elif path == "/projects":
        if state["mode"] == "error":
            route.fulfill(status=500, json={"detail": "Preview failure"})
            return
        data = [] if empty else projects
    elif path == "/series": data = [] if empty or state["mode"] not in ("series", "series_error") else [{"id": "series", "title": "测试系列", "episode_ids": ["episode"], "characters": [], "scenes": [], "props": []}]
    elif path == "/series/series/episodes" and state["mode"] == "series_error":
        route.fulfill(status=500, json={"detail": "Episode refresh failed"})
        return
    elif path == "/series/series/episodes": data = [{**projects[0], "id": "episode", "title": "系列剧集", "series_id": "series", "updated_at": 1900000000}]
    else: data = []
    route.fulfill(json=data)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1024}, reduced_motion="reduce")
    page.route("**/api-proxy/**", respond)
    page.route("**/auth/setup-status", respond)
    page.route("**/auth/me", respond)
    page.route("**/auth/legacy-claim/**", respond)
    page.goto(url, wait_until="load")
    expect(page.get_by_role("heading", name="欢迎回来，Dylan")).to_be_visible(timeout=30000)
    expect(page.get_by_role("heading", name="夜航信号", exact=True)).to_be_visible()
    page.evaluate("document.fonts.ready")
    page.wait_for_function("Array.from(document.querySelectorAll('img')).every(img => img.complete)")
    page.wait_for_function("getComputedStyle(document.body).margin === '0px'")
    page.screenshot(path=str(output / "desktop.png"), full_page=True)
    assert page.locator('[aria-busy]').evaluate("el => el.scrollHeight <= el.parentElement.clientHeight + 1"), "Desktop reference viewport should fit"
    print("Initial workspace screenshot captured")
    for width, height in [(1440, 1024), (1366, 768), (1280, 720), (1024, 768), (768, 1024), (390, 844), (320, 568)]:
        page.set_viewport_size({"width": width, "height": height})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width, "horizontal overflow")
        assert page.locator('[aria-busy]').evaluate("el => el.scrollWidth <= el.clientWidth"), (width, "workspace content overflow")
        queue = page.get_by_text("渲染队列", exact=True)
        queue.scroll_into_view_if_needed()
        assert queue.evaluate("el => { const r=el.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return r.bottom<=innerHeight && (hit===el || el.contains(hit)); }"), (width, "queue obstructed")
        if width in (1366, 390, 320):
            page.screenshot(path=str(output / f"{width}-bottom.png"))
        if width in (390, 320):
            page.get_by_role("heading", name="欢迎回来，Dylan").scroll_into_view_if_needed()
            page.screenshot(path=str(output / f"{width}-top.png"))
        page.get_by_role("button", name="Dylan", exact=True).click()
        expect(page.get_by_role("button", name="退出登录", exact=True)).to_be_visible()
        page.keyboard.press("Escape")
    page.set_viewport_size({"width": 1440, "height": 1024})
    page.get_by_role("button", name="创建新项目", exact=True).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    expect(dialog.get_by_role("textbox", name="项目标题")).to_be_focused()
    for _ in range(15):
        page.keyboard.press("Tab")
        assert dialog.evaluate("el => el.contains(document.activeElement)"), "Dialog focus escaped"
    for width, height in [(320, 568), (390, 844), (844, 390), (1440, 1024)]:
        page.set_viewport_size({"width": width, "height": height})
        for name in ("取消", "创建项目"):
            assert dialog.get_by_role("button", name=name, exact=True).evaluate("""el => {
                const r=el.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
                return r.bottom <= innerHeight - 8 && r.left >= 0 && r.right <= innerWidth && (hit===el || el.contains(hit) || (el.disabled && hit?.contains(el)));
            }"""), (width, height, name, "dialog footer obstructed")
    page.keyboard.press("Escape")
    expect(page.get_by_role("button", name="创建新项目", exact=True)).to_be_focused()
    page.get_by_role("link", name="搜索项目", exact=True).click()
    expect(page.get_by_role("searchbox", name="搜索项目 / 系列…")).to_be_visible()
    page.goto(url, wait_until="load")
    state["mode"] = "series"
    page.get_by_role("button", name="刷新工作区", exact=True).click()
    expect(page.get_by_role("heading", name="系列剧集", exact=True)).to_be_visible()
    state["mode"] = "series_error"
    page.get_by_role("button", name="刷新工作区", exact=True).click()
    expect(page.get_by_text("部分项目未能加载，请重试。")).to_be_visible()
    expect(page.get_by_role("heading", name="系列剧集", exact=True)).to_be_visible()
    state["mode"] = "series"
    page.get_by_role("button", name="重试", exact=True).click()
    expect(page.get_by_text("部分项目未能加载，请重试。")).not_to_be_visible()
    page.get_by_role("button", name="Dylan", exact=True).click()
    page.get_by_role("combobox", name="当前 Workspace").select_option("empty")
    page.keyboard.press("Escape")
    expect(page.get_by_role("heading", name="从一个故事开始")).to_be_visible()
    expect(page.get_by_role("heading", name="系列剧集", exact=True)).not_to_be_visible()
    state["mode"] = "empty"
    page.get_by_role("button", name="刷新工作区", exact=True).click()
    expect(page.get_by_role("heading", name="从一个故事开始")).to_be_visible()
    page.screenshot(path=str(output / "empty.png"))
    state["mode"] = "error"
    page.get_by_role("button", name="刷新工作区", exact=True).click()
    expect(page.get_by_text("部分项目未能加载，请重试。")).to_be_visible()
    expect(page.get_by_role("heading", name="从一个故事开始")).not_to_be_visible()
    page.get_by_role("button", name="重试", exact=True).click()
    expect(page.get_by_text("队列状态暂不可用")).to_be_visible()
    page.set_viewport_size({"width": 320, "height": 568})
    page.get_by_role("button", name="创建新项目", exact=True).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    cancel = dialog.get_by_role("button", name="取消", exact=True)
    cancel.scroll_into_view_if_needed()
    assert cancel.evaluate("el => {const r=el.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return r.bottom<innerHeight && (hit===el || el.contains(hit));}"), "Dialog controls obstructed"
    page.keyboard.press("Escape")
    expect(dialog).not_to_be_visible()
    state["mode"] = "populated"
    page.get_by_role("button", name="Dylan", exact=True).click()
    page.get_by_role("combobox", name="当前 Workspace").select_option("preview")
    page.keyboard.press("Escape")
    user["display_name"] = "A creator with a very long display name"
    projects[0]["title"] = "A long story title that must wrap without obscuring the project controls"
    page.evaluate("""() => {
        const settings = JSON.parse(localStorage.getItem('omni_studio-settings') || '{"state":{},"version":0}');
        settings.state.locale = 'en';
        localStorage.setItem('omni_studio-settings', JSON.stringify(settings));
    }""")
    page.reload(wait_until="load")
    expect(page.get_by_role("heading", name="Welcome back, " + user["display_name"])).to_be_visible()
    for width in (1440, 390, 320):
        page.set_viewport_size({"width": width, "height": 844})
        assert page.locator('[aria-busy]').evaluate("el => el.scrollWidth <= el.clientWidth"), (width, "English content overflow")
    assert not unexpected_writes, unexpected_writes
    browser.close()
print("PASS: populated/empty/error states, 7 viewports, bottom-edge hit tests, account menu, creation dialog and search route; no backend writes")
