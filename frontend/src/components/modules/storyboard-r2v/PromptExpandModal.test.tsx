import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import PromptExpandModal from './PromptExpandModal';

it('asks before discarding an edited prompt and preserves the draft when continuing', async () => {
    const close = vi.fn(), save = vi.fn();
    renderWithIntl(<PromptExpandModal initialValue="original" shotLabel="1" onSave={save} onClose={close} />);
    fireEvent.change(screen.getByRole('textbox'), {target:{value:'unsaved draft'}});
    fireEvent.click(screen.getByRole('button', {name:'关闭'}));
    expect(await screen.findByRole('dialog', {name:'有未保存的修改'})).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name:'继续编辑'}));
    expect(screen.getByRole('textbox')).toHaveValue('unsaved draft');
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox'), {key:'Enter',ctrlKey:true});
    expect(save).toHaveBeenCalledWith('unsaved draft');
});
