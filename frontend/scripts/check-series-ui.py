"""Exercise the local in-memory preview only; never uses a real workspace."""
from pathlib import Path
from time import time_ns
from playwright.sync_api import sync_playwright, expect

base = "http://127.0.0.1:3020"
series_id = "ui-preview-series"
output = Path(__file__).resolve().parents[2] / "docs/agents/context/series-overview"
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1024})
    failures = []
    page.on("pageerror", lambda error: failures.append(str(error)))
    page.goto(f"{base}/#/series/{series_id}")
    expect(page.get_by_role("heading", name="夜航信号", exact=True, level=1)).to_be_visible()
    for width, height in [(1440, 1024), (1024, 768), (844, 390), (390, 844), (320, 740)]:
        page.set_viewport_size({"width": width, "height": height})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width, "overflow")
        page.get_by_role("button", name="新建单集", exact=True).click()
        dialog = page.get_by_role("dialog", name="新建单集")
        expect(dialog).to_be_visible()
        for _ in range(12):
            page.keyboard.press("Tab")
            assert dialog.evaluate("el => el.contains(document.activeElement)"), "focus escaped"
        cancel = dialog.get_by_role("button", name="取消", exact=True)
        cancel.scroll_into_view_if_needed()
        assert cancel.evaluate("el => { const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }"), (width, "blocked cancel")
        page.screenshot(path=str(output / f"dialog-{width}.png"))
        page.keyboard.press("Escape")
        expect(dialog).not_to_be_visible()
        assert page.locator("header").evaluate("el => getComputedStyle(el).position === 'relative'"), (width, "series styles missing")
        page.screenshot(path=str(output / f"series-{width}.png"))
    page.set_viewport_size({"width": 1440, "height": 1024})
    page.get_by_role("button", name="编辑系列", exact=True).click()
    dialog = page.get_by_role("dialog", name="编辑系列")
    dialog.get_by_role("textbox", name="标题", exact=False).fill("保留的编辑内容")
    page.route(f"**/api-proxy/series/{series_id}", lambda route: route.fulfill(status=500, json={"detail": "Preview acceptance failure"}) if route.request.method == "PUT" else route.continue_())
    dialog.get_by_role("button", name="保存", exact=True).click()
    expect(dialog.get_by_role("alert")).to_contain_text("保存失败")
    expect(dialog.get_by_role("textbox", name="标题", exact=False)).to_have_value("保留的编辑内容")
    page.keyboard.press("Escape")
    page.unroute(f"**/api-proxy/series/{series_id}")
    title = f"浏览器验收-{time_ns()}"
    page.get_by_role("button", name="新建单集", exact=True).click()
    dialog = page.get_by_role("dialog", name="新建单集")
    dialog.get_by_role("textbox", name="标题", exact=False).fill(title)
    dialog.get_by_role("button", name="保存", exact=True).click()
    link = page.get_by_role("link", name=title, exact=False)
    expect(link).to_be_visible()
    episode_id = link.get_attribute("href").split("/")[-1]
    try:
        link.click()
        expect(page.locator('[aria-readonly="false"]')).to_be_visible()
        original = browser.new_page()
        original.goto(f"http://127.0.0.1:3022/#/series/{series_id}")
        expect(original.get_by_text(title, exact=True)).to_be_visible()
        original.screenshot(path=str(output / "original-series.png"))
        original.close()
    finally:
        assert page.request.delete(f"{base}/api-proxy/projects/{episode_id}").ok
    assert not failures, failures
    browser.close()
print("PASS: series layout, focus, error retention, episode creation, edit lease, and original/new shared data")
