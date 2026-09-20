import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import StoryboardAnalysisFeedback from './StoryboardAnalysisFeedback';

it('keeps analysis failures visible and retryable', () => {
    const retry = vi.fn();
    render(<StoryboardAnalysisFeedback error="模型输出格式异常" success="" retryLabel="重试生成" onRetry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('模型输出格式异常');
    fireEvent.click(screen.getByRole('button', { name: '重试生成' }));
    expect(retry).toHaveBeenCalledOnce();
});

it('announces successful storyboard generation without an interrupting dialog', () => {
    render(<StoryboardAnalysisFeedback error="" success="成功生成 3 个分镜帧" retryLabel="重试生成" onRetry={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('成功生成 3 个分镜帧');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
