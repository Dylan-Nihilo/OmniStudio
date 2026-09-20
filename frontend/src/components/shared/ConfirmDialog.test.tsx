import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import ConfirmDialog from './ConfirmDialog';

it('exposes cancel and confirm actions through the shared dialog contract', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderWithIntl(<ConfirmDialog open title="删除镜头" message="确认删除？" confirmLabel="删除" cancelLabel="取消" onCancel={onCancel} onConfirm={onConfirm} />);
    const dialog = screen.getByRole('dialog', { name: '删除镜头' });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(dialog).toBeVisible();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
});
