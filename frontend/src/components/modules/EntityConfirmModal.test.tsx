import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import EntityConfirmModal from './EntityConfirmModal';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
it('provides a named dialog and prevents dismissal or duplicate application while applying', () => {
  const apply = vi.fn(), discard = vi.fn();
  const props = { isOpen: true, preview: { characters: [{ name: 'Mara' }], scenes: [], props: [] }, currentCounts: { characters: 0, scenes: 0, props: 0 }, onConfirm: apply, onDiscard: discard };
  const view = render(<EntityConfirmModal {...props} />);
  expect(screen.getByRole('dialog', { name: 'extractConfirmTitle' })).toBeVisible();
  expect(screen.getByText('Mara')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'extractApply' }));
  expect(apply).toHaveBeenCalledOnce();
  view.rerender(<EntityConfirmModal {...props} isPending />);
  expect(screen.getByRole('button', { name: 'extractApply' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'extractApply' }));
  expect(apply).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'extractDiscard' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'close' })).toBeDisabled();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(discard).not.toHaveBeenCalled();
});

it('returns only the entities that remain selected', () => {
  const apply = vi.fn(), discard = vi.fn();
  const preview = {
    characters: [{ id: 'char-mara', name: 'Mara' }],
    scenes: [{ id: 'scene-street', name: 'Street' }],
    props: [{ id: 'prop-lantern', name: 'Lantern' }],
  };
  render(<EntityConfirmModal
    isOpen
    preview={preview}
    currentCounts={{ characters: 0, scenes: 0, props: 0 }}
    onConfirm={apply}
    onDiscard={discard}
  />);

  expect(screen.getByRole('checkbox', { name: 'Mara' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Street' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Lantern' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Mara' }));
  fireEvent.click(screen.getByRole('button', { name: 'extractApply' }));

  expect(apply).toHaveBeenCalledWith({ characters: [], scenes: [preview.scenes[0]], props: [preview.props[0]] });
});
