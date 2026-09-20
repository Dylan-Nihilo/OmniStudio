import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ProjectLoadState from './ProjectLoadState';

it('announces project loading as a busy page', () => {
    render(<ProjectLoadState loading loadFailed={false} onRetry={vi.fn()} onBack={vi.fn()}
        loadingLabel="正在加载项目" loadFailedLabel="项目加载失败" retryLabel="重试" backLabel="返回工作区" />);

    expect(screen.getByRole('status')).toHaveTextContent('正在加载项目');
    expect(screen.getByTestId('project-load-state')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('exposes retry and back actions after project loading fails', () => {
    const retry = vi.fn();
    const back = vi.fn();
    render(<ProjectLoadState loading={false} loadFailed onRetry={retry} onBack={back}
        loadingLabel="正在加载项目" loadFailedLabel="项目加载失败" retryLabel="重试" backLabel="返回工作区" />);

    expect(screen.getByRole('alert')).toHaveTextContent('项目加载失败');
    expect(screen.getByTestId('project-load-state')).toHaveAttribute('aria-busy', 'false');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    fireEvent.click(screen.getByRole('button', { name: '返回工作区' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(back).toHaveBeenCalledOnce();
});
