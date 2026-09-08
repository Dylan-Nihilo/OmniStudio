"""Check the isolated preview's script workflow; no real account or AI calls."""
from pathlib import Path
from time import time_ns
from playwright.sync_api import sync_playwright, expect

base = 'http://127.0.0.1:3020'
output = Path(__file__).resolve().parents[2] / 'docs/agents/context/script-page'
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1024})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    created = page.request.post(base + '/api-proxy/projects', data={'title': f'剧本验收-{time_ns()}', 'text': '外景 · 天台 · 夜\n\n城市在雨中亮起。', 'workflow_mode': 'r2v', 'series_id': 'ui-preview-series'})
    assert created.ok
    project = created.json()
    route = f"/#/series/ui-preview-series/episode/{project['id']}"
    editor = page.get_by_role('textbox', name='剧本编辑器', exact=True)
    try:
        page.goto(base + route)
        expect(editor).to_be_editable(timeout=60000)
        for width, height in [(1440, 1024), (1024, 768), (844, 390), (390, 844), (320, 740)]:
            page.set_viewport_size({'width': width, 'height': height})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, 'page overflow')
            for label in ['导入剧本', '分析剧本']:
                control = page.get_by_role('button', name=label, exact=True)
                control.scroll_into_view_if_needed()
                assert control.evaluate('el => { const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }'), (width, label, 'obscured')
            editor.scroll_into_view_if_needed()
            assert editor.evaluate('el => el.clientHeight >= 200'), (width, 'editor too short')
            save = page.get_by_role('button', name='保存', exact=True)
            save.scroll_into_view_if_needed()
            assert save.evaluate('el => { const r=el.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return el.contains(hit) || el.disabled && hit?.contains(el); }'), (width, 'save obscured')
            page.screenshot(path=str(output / f'script-{width}.png'))
        page.set_viewport_size({'width':1440, 'height':1024})
        draft = '外景 · 天台 · 夜\n\n保留下来的台词。'
        editor.fill(draft)
        page.get_by_role('button', name='保存', exact=True).click()
        expect(page.get_by_role('status').filter(has_text='已保存')).to_be_visible()
        assert page.request.get(base + f"/api-proxy/projects/{project['id']}").json()['original_text'] == draft
        original = browser.new_page(viewport={'width':1440, 'height':1024})
        original.goto('http://127.0.0.1:3022' + route)
        expect(original.locator('textarea').first).to_have_value(draft, timeout=60000)
        original.screenshot(path=str(output / 'original-script.png'))
        original.close()
        page.route('**/projects/*/text', lambda route: route.fulfill(status=500, json={'detail':'Acceptance save failure'}))
        editor.fill('保存失败也不丢失的内容')
        page.get_by_role('button', name='保存', exact=True).click()
        expect(page.get_by_role('alert').filter(has_text='保存失败')).to_be_visible()
        expect(editor).to_have_value('保存失败也不丢失的内容')
        page.unroute('**/projects/*/text')
        page.get_by_role('button', name='保存', exact=True).click()
        expect(page.get_by_role('status').filter(has_text='已保存')).to_be_visible()
        page.locator('input[type="file"]').set_input_files({'name':'import.md', 'mimeType':'text/markdown', 'buffer':'# 导入剧本\n新的场景。'.encode()})
        expect(editor).to_have_value('# 导入剧本\n新的场景。')
        page.get_by_role('button', name='保存', exact=True).click()
        expect(page.get_by_role('status').filter(has_text='已保存')).to_be_visible()
        # Existing extraction API still receives the edited text and opens confirmation.
        observed = []
        def preview(request):
            observed.append(request.request.post_data_json)
            request.fulfill(json={'characters':[{'id':'a','name':'玛拉','description':'寻找信号的人'}], 'scenes':[], 'props':[]})
        page.route('**/projects/*/extract_preview', preview)
        page.get_by_role('button', name='分析剧本', exact=True).click()
        expect(page.get_by_role('dialog')).to_be_visible()
        assert observed[-1]['text'] == '# 导入剧本\n新的场景。'
        page.screenshot(path=str(output / 'extraction-confirm.png'))
        # Reload clears the ephemeral confirmation before testing navigation.
        page.reload()
        expect(editor).to_be_editable()
        page.get_by_role('tab', name='前情回顾', exact=True).click()
        expect(page.get_by_text('PREV', exact=True)).to_be_visible()
        page.screenshot(path=str(output / 'previous-episode.png'))
        page.get_by_role('row', name='合成', exact=False).click()
        page.locator('summary').filter(has_text='切换单集').click()
        page.get_by_role('button', name='2 雨后城市', exact=True).click()
        expect(page).to_have_url(base + '/#/series/ui-preview-series/episode/ui-preview-1#assembly')
        expect(page.get_by_role('row', name='合成', exact=False)).to_have_attribute('aria-current','page')
        page.reload()
        expect(page.get_by_role('row', name='合成', exact=False)).to_have_attribute('aria-current','page',timeout=30000)
        page.get_by_role('row', name='脚本', exact=True).click()
        expect(editor).to_be_editable()
        assert not errors, errors
    finally:
        assert page.request.delete(base + f"/api-proxy/projects/{project['id']}").ok
        browser.close()
print('PASS: five viewports, saves shared with original, failure retention, extraction, previous episode, step-preserving episode navigation')
