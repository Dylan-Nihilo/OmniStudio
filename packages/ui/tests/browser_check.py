"""Run against `npm run dev`; uses the machine's Python Playwright installation."""
from pathlib import Path
import re
import sys
from playwright.sync_api import expect, sync_playwright


def check():
    output = Path(__file__).resolve().parents[3] / 'docs/agents/context/component-library'
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3018/')
        page.wait_for_load_state('networkidle')

        checkbox_control = page.locator('.omni-checkbox .checkbox__control').first
        assert checkbox_control.evaluate('''el => {
            const control = getComputedStyle(el);
            const fill = getComputedStyle(el, '::before');
            return fill.borderRadius === control.borderRadius &&
                parseFloat(fill.top) === -parseFloat(control.borderTopWidth);
        }'''), 'Checkbox fill must follow the outer radius and cover the border inset'

        password = page.get_by_label('密码', exact=True)
        password.fill('test-password')
        page.get_by_role('button', name='显示密码', exact=True).click()
        expect(password).to_have_attribute('type', 'text')
        expect(password).to_have_value('test-password')
        page.get_by_role('button', name='隐藏密码', exact=True).click()
        expect(password).to_have_attribute('type', 'password')

        selector = page.locator('.select__trigger')
        selector.focus()
        page.keyboard.press('ArrowDown')
        page.get_by_role('option', name='可灵 视频生成', exact=True).click()
        expect(selector).to_contain_text('可灵')
        expect(selector).to_be_focused()

        page.get_by_role('tab', name='角色', exact=True).focus()
        page.keyboard.press('ArrowRight')
        expect(page.get_by_role('tab', name='场景', exact=True)).to_have_attribute('aria-selected', 'true')
        expect(page.get_by_role('tabpanel')).to_contain_text('2 个场景')

        page.get_by_role('row', name='系列', exact=True).click()
        expect(page.get_by_role('row', name='系列', exact=True)).to_have_attribute('aria-current', 'page')
        page.get_by_role('button', name=re.compile('导出')).click()
        expect(page.locator('.omni-workflow-steps > li').last).to_have_attribute('data-status', 'active')

        trigger = page.get_by_role('button', name='编辑项目信息', exact=True)
        trigger.click()
        dialog = page.get_by_role('dialog', name='编辑项目信息')
        expect(dialog).to_be_visible()
        for _ in range(8):
            page.keyboard.press('Tab')
            assert dialog.evaluate('(el) => el.contains(document.activeElement)'), 'Focus escaped dialog'
        page.screenshot(path=str(output / 'dialog-desktop.png'), animations='disabled')
        page.keyboard.press('Escape')
        expect(dialog).not_to_be_visible()
        expect(trigger).to_be_focused()
        page.screenshot(path=str(output / 'desktop.png'), full_page=True, animations='disabled')

        primary = page.get_by_role('button', name='新建项目', exact=True).first
        assert primary.evaluate('(el) => getComputedStyle(el).backgroundColor') == 'rgb(29, 58, 95)'
        assert primary.bounding_box()['height'] == 40
        assert page.get_by_label('邮箱', exact=True).bounding_box()['height'] == 40

        for width in (390, 320):
            page.set_viewport_size({'width': width, 'height': 844})
            page.evaluate('window.scrollTo(0, 0)')
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow at {width}px'
            page.screenshot(path=str(output / f'mobile-{width}.png'), full_page=True, animations='disabled')
            page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            page.screenshot(path=str(output / f'bottom-{width}.png'), animations='disabled')
            trigger.click()
            expect(dialog).to_be_visible()
            rect = dialog.bounding_box()
            assert rect['x'] >= 0 and rect['x'] + rect['width'] <= width
            assert rect['y'] >= 0 and rect['y'] + rect['height'] <= 844
            page.screenshot(path=str(output / f'dialog-{width}.png'), animations='disabled')
            page.get_by_role('button', name='关闭对话框', exact=True).click()
            expect(dialog).not_to_be_visible()
        assert not errors, errors
        browser.close()
        print('PASS: fields, selection, tabs, Pro navigation/steps, dialog focus, tokens and 1440/390/320px layouts')


if __name__ == '__main__':
    check()
