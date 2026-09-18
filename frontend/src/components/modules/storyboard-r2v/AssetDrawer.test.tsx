import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import { LightboxProvider } from '@/components/shared/preview/LightboxProvider';
import AssetDrawer from './AssetDrawer';

it('offers the selected holding image separately from the base character', () => {
    const select = vi.fn();
    const close = vi.fn();
    const character = { id: 'hero', name: '陆青',
        reference_sheet: { selected_image_id: 'base', image_variants: [{ id: 'base', url: '/base.png' }] },
        holding_reference: { selected_image_id: 'holding', image_variants: [{ id: 'holding', url: '/holding.png' }] },
    };
    const view = renderWithIntl(<LightboxProvider><AssetDrawer isOpen onClose={close} characters={[character]} scenes={[]} props={[]} onSelectAsset={select} /></LightboxProvider>);
    expect(screen.getByRole('img', { name: '陆青' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /陆青（持物）/ }));
    expect(select).toHaveBeenCalledWith('character2', '陆青（持物）');
    expect(close).toHaveBeenCalledOnce();
    expect(character.reference_sheet.selected_image_id).toBe('base');
    view.unmount();
    renderWithIntl(<LightboxProvider><AssetDrawer isOpen onClose={close} characters={[character]} scenes={[]} props={[]} onSelectAsset={select} selectedNames={['陆青（持物）']} /></LightboxProvider>);
    const added = screen.getByRole('button', { name: '陆青（持物），已添加' });
    expect(added).toBeDisabled();
    fireEvent.click(added);
    expect(select).toHaveBeenCalledOnce();
});
