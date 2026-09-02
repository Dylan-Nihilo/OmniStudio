// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PolishPanel from './PolishPanel';

const mocks = vi.hoisted(() => ({
  polishVideoPrompt: vi.fn(),
  polishR2VPrompt: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('@/lib/debugLog', () => ({ debugLog: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/components/shared/BorderGlow/BorderGlow', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="border-glow">{children}</div>,
}));
vi.mock('@/components/shared/WorkflowActionButton', () => ({
  default: ({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

describe('PolishPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.polishVideoPrompt.mockResolvedValue({ prompt_cn: '中文结果', prompt_en: 'English result' });
  });

  it('uses theme surfaces while the polish result is loading', async () => {
    let resolveRequest: ((value: { prompt_cn: string; prompt_en: string }) => void) | undefined;
    mocks.polishVideoPrompt.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));

    render(<PolishPanel prompt="原始提示词" tabMode="t2i_i2v" scriptId="script-1" onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'polish' }));

    expect(screen.getAllByTestId('border-glow')).toHaveLength(1);
    expect(document.querySelectorAll('.bg-black\\/30')).toHaveLength(0);

    resolveRequest?.({ prompt_cn: '中文结果', prompt_en: 'English result' });
    await waitFor(() => expect(screen.getByText('中文结果')).toBeInTheDocument());
    expect(document.querySelectorAll('.bg-black\\/20, .bg-black\\/30')).toHaveLength(0);
  });

  it('does not restore a result after the user closes an in-flight polish request', async () => {
    let resolveRequest: ((value: { prompt_cn: string; prompt_en: string }) => void) | undefined;
    mocks.polishVideoPrompt.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));

    render(<PolishPanel prompt="原始提示词" tabMode="t2i_i2v" scriptId="script-1" onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'polish' }));
    fireEvent.click(screen.getByRole('button', { name: 'polishDiscard' }));
    resolveRequest?.({ prompt_cn: '不应显示', prompt_en: 'Must not show' });

    await waitFor(() => expect(screen.queryByText('不应显示')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'polish' })).toBeInTheDocument();
  });

  it('does not render empty bilingual result bars for a failed request', async () => {
    mocks.polishVideoPrompt.mockRejectedValue({
      response: { data: { detail: { reason: 'api_error' } } },
    });

    render(<PolishPanel prompt="原始提示词" tabMode="t2i_i2v" scriptId="script-1" onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'polish' }));

    await waitFor(() => expect(screen.getByText('polishErrorApi')).toBeInTheDocument());
    expect(screen.queryByText('polishCnLabel')).not.toBeInTheDocument();
    expect(screen.queryByText('polishEnLabel')).not.toBeInTheDocument();
  });
});
