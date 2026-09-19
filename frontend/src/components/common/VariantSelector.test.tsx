import { fireEvent, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import { VariantSelector } from './VariantSelector';

it('requires confirmation for both main and thumbnail candidate deletion and allows cancelling', () => {
    const remove = vi.fn();
    renderWithIntl(<VariantSelector asset={{ selected_id: 'a', variants: [{ id: 'a', url: '/a.png' }] } as any}
        onDelete={remove} onSelect={vi.fn()} onGenerate={vi.fn()} isGenerating={false} />);
    const buttons = screen.getAllByTitle('删除此变体');
    fireEvent.click(buttons[0]);
    expect(remove).not.toHaveBeenCalled();
    let dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(buttons[1]);
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(remove).toHaveBeenCalledExactlyOnceWith('a');
});
