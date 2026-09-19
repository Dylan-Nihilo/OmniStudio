import { expect, it } from 'vitest';
import { getVideoCreatorError } from './VideoCreator';

it('normalizes video creator errors for retryable in-app feedback', () => {
    expect(getVideoCreatorError({ response: { data: { detail: '模型暂时不可用' } } }, '提交失败')).toBe('模型暂时不可用');
    expect(getVideoCreatorError(new Error('network unavailable'), '提交失败')).toBe('network unavailable');
});
