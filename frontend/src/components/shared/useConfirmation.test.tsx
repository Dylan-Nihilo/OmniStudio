import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import { useConfirmation } from './useConfirmation';

it('waits for the user, cancels on close, and confirms one pending action', async () => {
    const action = vi.fn();
    function Example() {
        const { confirm, dialog } = useConfirmation();
        return <>{dialog}<button onClick={async () => { if (await confirm('移除这张测试图片？')) action(); }}>移除</button></>;
    }
    renderWithIntl(<Example />);
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
});
