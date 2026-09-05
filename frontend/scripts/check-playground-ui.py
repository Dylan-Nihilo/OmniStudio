"""Check the local Playground layout and inputs without opening visible windows."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[2]
output = root / 'docs/agents/context/playground-page'
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width':1440,'height':1024}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://localhost:3020/#/playground')
    prompt = page.get_by_label('Prompt', exact=True)
    expect(prompt).to_be_visible(timeout=60000)
    page.wait_for_function("()=>{const el=document.querySelector('[class*=PlaygroundPage_body]');return el && getComputedStyle(el).display==='grid';}")
    prompt.fill('月光下的海面')
    for width,height in [(1440,1024),(1280,720),(1024,768),(390,844),(320,740)]:
        page.set_viewport_size({'width':width,'height':height})
        expect(prompt).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        header = page.locator('[class*=PlaygroundPage_header]')
        assert header.bounding_box()['height'] <= 110, (width,header.bounding_box())
        button = page.get_by_role('button',name='生成',exact=True)
        button.scroll_into_view_if_needed()
        assert button.evaluate('el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}'), (width,'generate obscured')
        if width >= 768:
            assert button.bounding_box()['y'] + button.bounding_box()['height'] <= height, width
        if width == 320:
            page.get_by_role('button',name=re.compile('生成模式')).click()
            page.get_by_role('option',name='图生图',exact=True).click()
            expect(button).to_be_disabled()
            page.get_by_role('button',name=re.compile('生成模式')).click()
            page.get_by_role('option',name='文生图',exact=True).click()
        page.screenshot(path=str(output / f'playground-{width}.png'))
    page.set_viewport_size({'width':1440,'height':1024})
    page.get_by_role('button',name=re.compile('模型')).click()
    page.get_by_role('option').first.click()
    page.locator('summary').filter(has_text='负面提示词').click()
    page.get_by_label('负面提示词',exact=True).fill('模糊')
    page.get_by_role('button',name='x4',exact=True).click()
    with page.expect_request('**/playground/generate') as req:
        page.get_by_role('button',name='生成 ×4',exact=True).click()
    body=req.value.post_data_json
    assert body['prompt']=='月光下的海面' and body['negative_prompt']=='模糊' and body['batch_size']==4,body
    # Browser-local completed fixtures exercise dense content without creating jobs.
    history = [{'id':'layout-example', 'mode':'t2i','model_id':'gpt-image-2','prompt':'月光下的海面','status':'completed','created_at':'2026-09-05T12:00:00Z','batch_size':4,'outputs':[{'id':str(i),'media_type':'image','media_path':'http://localhost:3020/auth/hero-night-signal.png?candidate='+str(i)} for i in range(4)]}]
    page.route('**/playground/history?*',lambda route:route.fulfill(json=history))
    page.reload()
    expect(page.get_by_role('heading',name='生成结果4',exact=True)).to_be_visible(timeout=60000)
    for width,height in [(1440,1024),(1280,720),(390,844),(320,740)]:
        page.set_viewport_size({'width':width,'height':height})
        page.get_by_role('heading',name='生成结果4',exact=True).scroll_into_view_if_needed()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        page.screenshot(path=str(output / f'playground-results-{width}.png'))
    page.set_viewport_size({'width':1440,'height':1024})
    page.get_by_role('button',name='候选 2',exact=True).click()
    expect(page.get_by_role('button',name='候选 2',exact=True)).to_have_attribute('aria-pressed','true')
    prompt.fill('继续写提示词')
    prompt.press('Enter')
    expect(prompt).to_be_focused()
    page.get_by_role('button',name='使用所选候选作为参考',exact=True).click()
    expect(page.get_by_role('button',name='图生图',exact=True)).to_have_attribute('aria-pressed','true')
    expect(page.locator('[class*=PlaygroundPage_composer] img').first).to_have_attribute('src',re.compile('candidate=1'))
    page.unroute('**/playground/history?*')
    page.route('**/playground/history?*', lambda route:route.fulfill(status=500,json={'detail':'unavailable'}))
    page.reload()
    expect(page.get_by_role('alert').filter(has_text='生成记录加载失败')).to_be_visible(timeout=60000)
    expect(page.get_by_text('暂无生成结果',exact=True)).not_to_be_visible()
    page.unroute('**/playground/history?*')
    history[0]['status']='processing'
    history[0]['outputs']=[]
    page.route('**/playground/history?*',lambda route:route.fulfill(json=history))
    page.get_by_role('button',name='重试',exact=True).click()
    status=page.get_by_role('status').filter(has_text='生成中')
    expect(status).to_be_visible()
    page.screenshot(path=str(output / 'playground-processing.png'))
    assert not errors, errors
    browser.close()
print('Playground: responsive layout, unobscured generation, modes, and request payload verified.')
