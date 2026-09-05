"""Run with the machine's Playwright against an unauthenticated dev server."""
import sys
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3019/#/login"
output = Path(__file__).resolve().parents[2] / "docs/agents/context/login-viewport-fix"
output.mkdir(parents=True, exist_ok=True)
sizes = [(1920, 1080), (1440, 900), (1366, 768), (1280, 720), (1024, 600),
         (768, 1024), (390, 844), (375, 667), (320, 568), (844, 390)]

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(reduced_motion="reduce")
    page.goto(url, wait_until="load")
    expect(page.get_by_test_id("auth-panel")).to_be_visible()
    for locale in ("zh", "en"):
        page.evaluate("""locale => {
            const settings = JSON.parse(localStorage.getItem('omni_studio-settings') || '{"state":{},"version":0}');
            settings.state.locale = locale;
            localStorage.setItem('omni_studio-settings', JSON.stringify(settings));
        }""", locale)
        page.reload(wait_until="load")
        page.evaluate("document.fonts.ready")
        expect(page.get_by_test_id("auth-panel")).to_be_visible()
        for error in (False, True):
            if error:
                # Exercise the real form layout without creating a session.
                page.route("**/auth/login", lambda route: route.fulfill(status=500, json={"error": {"code": "INTERNAL_ERROR"}}))
                page.locator('input[name="username"]').fill("preview-artist")
                page.locator('input[name="password"]').fill("example-password")
                page.locator('button[type="submit"]').click()
                expect(page.get_by_test_id("auth-panel").get_by_role("alert")).to_be_visible()
            for width, height in sizes:
                page.set_viewport_size({"width": width, "height": height})
                # Next dev can briefly replace the global stylesheet during HMR.
                page.wait_for_function("getComputedStyle(document.body).margin === '0px'")
                metrics = page.get_by_test_id("auth-surface").evaluate("""el => ({
                    width: el.scrollWidth, height: el.scrollHeight,
                    clientWidth: el.clientWidth, clientHeight: el.clientHeight,
                    bottom: el.getBoundingClientRect().bottom
                })""")
                label = f"{locale} {width}x{height} error={error}"
                assert metrics["height"] <= metrics["clientHeight"] + 1, (label, metrics)
                assert metrics["width"] <= metrics["clientWidth"] + 1, (label, metrics)
                assert metrics["bottom"] <= height + 1, (label, metrics)
                # Bounding boxes alone miss overlays; hit-test every form control.
                for control in page.locator('form input, form button').all():
                    assert control.evaluate("""el => {
                        const r = el.getBoundingClientRect();
                        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                        return r.top >= 0 && r.bottom <= innerHeight - 8 &&
                            (hit === el || el.contains(hit));
                    }"""), (label, control.get_attribute("name") or control.inner_text())
                if locale == "zh" and width in (1366, 390, 320, 844):
                    page.screenshot(path=str(output / f"{width}x{height}{'-error' if error else ''}.png"))
    browser.close()
print("PASS: login fits 10 viewports in Chinese/English, including errors; all controls are visible and unobstructed")
