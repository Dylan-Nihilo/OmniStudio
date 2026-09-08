"""Exercise the in-memory Studio preview; no real generation or account writes."""
from pathlib import Path
from time import time_ns
import re
from playwright.sync_api import sync_playwright, expect

base = 'http://localhost:3020'
output = Path(__file__).resolve().parents[2] / 'docs/agents/context/studio-page'
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1024}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    project = page.request.post(base + '/api-proxy/projects', data={'title': f'制作台验收-{time_ns()}', 'text': '外景 · 天台 · 夜\n城市在雨中亮起。', 'workflow_mode': 'r2v', 'series_id': 'ui-preview-series'}).json()
    endpoint = base + '/api-proxy/projects/' + project['id']
    try:
        for text in ['第一镜，天台信号', '第二镜，雨中城市', '第三镜，离开天台']:
            response = page.request.post(endpoint + '/frames', data={'scene_id': '', 'action_description': text})
            assert response.ok
        frames = response.json()['frames']
        for frame in frames:
            assert page.request.patch(endpoint + '/frames/' + frame['id'] + '/workbench', data={'t2i_image_urls':[base + '/auth/hero-night-signal.png'], 't2i_selected_index':0}).ok
        page.goto(base + f"/#/series/ui-preview-series/episode/{project['id']}#storyboard_r2v")
        prompt = page.get_by_role('textbox', name='动作提示词', exact=True)
        expect(prompt).to_have_value('第一镜，天台信号', timeout=60000)
        for w,h in [(1440,1024),(1280,720),(1024,768),(390,844),(320,740)]:
            page.set_viewport_size({'width':w,'height':h})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (w, 'page overflow')
            for control in [prompt,page.get_by_role('button',name='镜头操作',exact=True),page.get_by_role('button',name='添加镜头',exact=True)]:
                control.scroll_into_view_if_needed()
                assert control.evaluate('el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}'), (w,'control obscured')
            page.screenshot(path=str(output/f'studio-{w}.png'))
        page.set_viewport_size({'width':1440,'height':1024})
        prompt.fill('第一镜，修改后的动作')
        with page.expect_response(lambda r: r.url.endswith('/frames/update') and r.request.method == 'POST'):
            page.get_by_role('button',name='选择镜头 2',exact=True).click()
        expect(prompt).to_have_value('第二镜，雨中城市')
        assert page.request.get(endpoint).json()['frames'][0]['action_description'] == '第一镜，修改后的动作'
        page.get_by_role('button',name='选择镜头 1',exact=True).click()
        expect(prompt).to_have_value('第一镜，修改后的动作')
        def action(name):
            page.get_by_role('button',name='镜头操作',exact=True).click()
            page.get_by_role('menuitem',name=name,exact=True).click()
        page.route('**/frames/reorder', lambda r: r.fulfill(status=500,json={'detail':'排序保存失败'}))
        action('下移')
        expect(page.get_by_text('保存失败，请重试',exact=True)).to_be_visible()
        expect(prompt).to_have_value('第一镜，修改后的动作')
        assert page.request.get(endpoint).json()['frames'][0]['id'] == frames[0]['id']
        page.unroute('**/frames/reorder')
        with page.expect_response(lambda r:r.url.endswith('/frames/reorder')):
            action('下移')
        expect(page.get_by_role('button',name='选择镜头 2',exact=True)).to_have_attribute('aria-pressed','true')
        assert page.request.get(endpoint).json()['frames'][1]['id'] == frames[0]['id']
        with page.expect_response(lambda r:r.url.endswith('/frames/copy')):
            action('复制镜头')
        expect(page.get_by_role('button',name='选择镜头 3',exact=True)).to_have_attribute('aria-pressed','true')
        assert len(page.request.get(endpoint).json()['frames']) == 4
        copied = page.request.get(endpoint).json()['frames'][2]['id']
        page.route('**/frames/'+copied,lambda r:r.fulfill(status=500,json={'detail':'删除失败'}))
        action('删除镜头')
        expect(page.get_by_role('button',name='选择镜头 4',exact=True)).to_be_visible()
        page.unroute('**/frames/'+copied)
        with page.expect_response(lambda r:r.url.endswith('/frames/'+copied)):
            action('删除镜头')
        expect(page.get_by_role('button',name='选择镜头 4',exact=True)).not_to_be_visible()
        assert len(page.request.get(endpoint).json()['frames']) == 3
        page.get_by_role('button',name=re.compile('生成方式')).click()
        page.get_by_role('option',name='首帧生图+I2V',exact=True).click()
        with page.expect_response(lambda r:r.url.endswith('/workbench') and r.request.method=='PATCH'):
            page.get_by_role('button',name=re.compile('数量')).click()
            page.get_by_role('option',name='4',exact=True).click()
        assert page.request.get(endpoint).json()['frames'][2]['workbench_generate_count'] == 4
        expect(page.get_by_role('button',name='生成 ×4',exact=True)).to_be_enabled()
        with page.expect_response(lambda r:'/video_tasks' in r.url and r.request.method=='POST') as generation:
            page.get_by_role('button',name='生成 ×4',exact=True).click()
        assert generation.value.status == 501
        expect(page.get_by_role('button',name='生成 ×4',exact=True)).to_be_enabled(timeout=15000)
        with page.expect_response(lambda r:r.url.endswith('/frames') and r.request.method=='POST'):
            page.get_by_role('button',name='添加镜头',exact=True).click()
        expect(prompt).to_have_value('')
        assert len(page.request.get(endpoint).json()['frames']) == 4
        page.get_by_role('button',name='✨ 生成分镜',exact=True).click()
        page.get_by_role('button',name='去 Script 步骤补充',exact=True).click()
        expect(page.get_by_role('textbox',name='剧本编辑器',exact=True)).to_be_visible()
        page.goto(base + f"/#/series/ui-preview-series/episode/{project['id']}#storyboard_r2v")
        page.reload()
        expect(prompt).to_be_visible(timeout=60000)
        page.get_by_role('button',name='预览剪辑',exact=True).click()
        expect(page.get_by_role('button',name='镜头操作',exact=True)).not_to_be_visible()
        assert not errors, errors
        print('PASS: five viewports, selected-shot editing, save across selection, reorder/delete failure retention, copy/add, persisted mode/count, generation failure recovery, assembly navigation')
    finally:
        page.request.delete(endpoint)
        browser.close()
