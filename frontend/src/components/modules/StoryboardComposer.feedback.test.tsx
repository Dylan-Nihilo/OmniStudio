import { expect, it } from 'vitest';
import { getStoryboardError } from './StoryboardComposer';

it('normalizes storyboard action failures for inline or toast feedback', () => {
    expect(getStoryboardError({ response: { data: { detail: '镜头已被其他编辑者更新' } } }, '操作失败')).toBe('镜头已被其他编辑者更新');
    expect(getStoryboardError(new Error('network unavailable'), '操作失败')).toBe('network unavailable');
});
