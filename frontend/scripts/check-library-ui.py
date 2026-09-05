"""Verify library UI against the isolated in-memory preview on 3020/3022."""
from pathlib import Path
from time import time_ns
import re
from playwright.sync_api import sync_playwright, expect

base = 'http://localhost:3020'
root = Path(__file__).resolve().parents[2]
output = root / 'docs/agents/context/library-page'
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width':1440,'height':1024}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    asset = None
    try:
        page.goto(base + '/#/library')
        card = page.get_by_role('button',name='玛拉 / 主形象定稿',exact=True)
        expect(card).to_be_visible(timeout=60000)
        page.wait_for_function("()=>{const el=document.querySelector('[class*=AssetLibraryPage_page]');return el && getComputedStyle(el).display==='flex';}")
        for width,height in [(1440,1024),(1280,720),(1024,768),(390,844),(320,740)]:
            page.set_viewport_size({'width':width,'height':height})
            expect(card).to_be_visible()
            if width < 768:
                expect(page.locator('nav[aria-label="资产库"] h2')).not_to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
            if width == 320:
                page.get_by_role('button',name=re.compile('来源')).click()
                page.get_by_role('option',name='全局 / 共享',exact=True).click()
                expect(card).to_be_visible()
                page.get_by_role('button',name=re.compile('来源')).click()
                page.get_by_role('option',name='全部来源',exact=True).click()
            card.click()
            panel = page.get_by_role('complementary',name='资产详情',exact=True)
            expect(panel).to_be_visible()
            for control in [panel.get_by_role('button',name='下载',exact=True), panel.get_by_role('button',name='关闭详情',exact=True)]:
                control.scroll_into_view_if_needed()
                assert control.evaluate('el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}'), (width,'obscured action')
            page.screenshot(path=str(output / f'library-{width}.png'))
            panel.get_by_role('button',name='关闭详情',exact=True).click()
            try:
                expect(card).to_be_focused()
            except AssertionError:
                print("Focus failure", width, page.evaluate("document.activeElement.outerHTML"), flush=True)
                raise
        page.set_viewport_size({'width':1440,'height':1024})
        page.get_by_role('button',name=re.compile('^场景')).click()
        expect(card).not_to_be_visible()
        expect(page.get_by_role('button',name='信号塔楼间',exact=True)).to_be_visible()
        page.get_by_role('button',name=re.compile(r'^全部\s*\d+$')).click()
        search = page.get_by_label('搜索资产...',exact=True)
        search.fill('不会匹配的素材')
        expect(page.get_by_text('没有匹配的资产',exact=True)).to_be_visible()
        page.get_by_role('button',name='清除筛选',exact=True).click()
        expect(card).to_be_visible()
        page.route('**/library/assets',lambda route:route.fulfill(status=500,json={'detail':'加载失败'}))
        page.get_by_role('button',name='刷新素材库',exact=True).click()
        expect(page.get_by_role('alert').filter(has_text='资产库加载失败')).to_be_visible()
        expect(card).to_be_visible()
        page.unroute('**/library/assets')
        page.get_by_role('button',name='重试',exact=True).click()
        expect(page.get_by_role('alert').filter(has_text='资产库加载失败')).not_to_be_visible()
        card.click()
        panel = page.get_by_role('complementary',name='资产详情',exact=True)
        page.route('**/library/assets/character/preview-library-0',lambda route:route.fulfill(status=500,json={'detail':'星标失败'}))
        panel.get_by_role('button',name='取消加星',exact=True).click()
        expect(page.get_by_text('星标保存失败，请重试',exact=True)).to_be_visible()
        expect(panel.get_by_role('button',name='取消加星',exact=True)).to_have_attribute('aria-pressed','true')
        page.unroute('**/library/assets/character/preview-library-0')
        with page.expect_download() as download:
            panel.get_by_role('button',name='下载',exact=True).click()
        assert download.value.suggested_filename.endswith('.png')
        page.keyboard.press('Escape')
        expect(panel).not_to_be_visible()
        page.get_by_role('button',name='新建资产',exact=True).click()
        dialog = page.get_by_role('dialog',name='新建全局资产',exact=True)
        expect(dialog).to_be_visible()
        name = '验收素材-' + str(time_ns())
        dialog.get_by_role('textbox',name=re.compile('^名称')).fill(name)
        with page.expect_response(lambda r:r.url.endswith('/library/assets/upload')) as upload:
            dialog.locator('input[type=file]').set_input_files(str(root / 'frontend/public/auth/hero-night-signal.png'))
        assert upload.value.status == 200
        for width,height in [(390,844),(320,740)]:
            page.set_viewport_size({'width':width,'height':height})
            create = dialog.get_by_role('button',name='创建',exact=True)
            create.scroll_into_view_if_needed()
            assert create.evaluate('el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}')
            page.keyboard.press('Tab')
            assert dialog.evaluate('el=>el.contains(document.activeElement)'), 'dialog focus escaped'
            page.screenshot(path=str(output / f'new-asset-{width}.png'))
        page.route('**/library/assets',lambda route:route.fulfill(status=500,json={'detail':'创建失败'}) if route.request.method=='POST' else route.continue_())
        dialog.get_by_role('button',name='创建',exact=True).click()
        expect(dialog.get_by_role('alert')).to_be_visible()
        expect(dialog.get_by_role('textbox',name=re.compile('^名称'))).to_have_value(name)
        page.unroute('**/library/assets')
        with page.expect_response(lambda r:r.url.endswith('/library/assets') and r.request.method=='POST') as created:
            dialog.get_by_role('button',name='创建',exact=True).click()
        asset = created.value.json()
        assert created.value.status == 200
        expect(dialog).not_to_be_visible()
        expect(page.get_by_role('button',name=name,exact=True)).to_be_visible()
        page.get_by_role('button',name=name,exact=True).click()
        panel = page.get_by_role('complementary',name='资产详情',exact=True)
        previous_image = panel.get_by_role('img',name=name,exact=True).get_attribute('src')
        replacement = str(root / 'frontend/public/assets/styles/japanese_anime__warm_hand_drawn_anime__forest_creature_valley_v2__landscape.png')
        update_route = '**/library/assets/character/' + asset['id']
        page.route(update_route,lambda route:route.fulfill(status=500,json={'detail':'替换保存失败'}))
        panel.locator('input[type=file]').set_input_files(replacement)
        expect(panel.get_by_role('alert')).to_be_visible()
        expect(panel.get_by_role('img',name=name,exact=True)).to_have_attribute('src',previous_image)
        page.unroute(update_route)
        with page.expect_response(lambda r:r.url.endswith('/library/assets/character/' + asset['id']) and r.request.method=='PUT') as replaced:
            panel.locator('input[type=file]').set_input_files(replacement)
        assert replaced.value.status == 200
        expect(panel.get_by_role('img',name=name,exact=True)).not_to_have_attribute('src',previous_image)
        new_image = panel.get_by_role('img',name=name,exact=True).get_attribute('src')
        assert len(replaced.value.json()['reference_sheet']['image_variants']) == 2
        original = browser.new_page()
        original.goto('http://localhost:3022/#/library')
        expect(original.get_by_role('img',name=name,exact=True)).to_be_visible(timeout=60000)
        expect(original.get_by_role('img',name=name,exact=True)).to_have_attribute('src',new_image)
        assert not errors, errors
        print('PASS: five viewports, detail close/focus, type/search filtering, retained data after refresh/star failure, download, upload/create failure retention, modal focus and mobile footer, replacement failure retention and refreshed master shared with original, mobile source filter.')
    finally:
        if asset:
            page.request.delete(base + '/api-proxy/library/assets/character/' + asset['id'])
        browser.close()
