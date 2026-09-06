import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CreateSeriesDialog from './CreateSeriesDialog';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ api: { createSeriesV2: create } }));

it('retains a failed draft and submits the selected series modes on retry', async () => {
  create.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'new-series' });
  const close = vi.fn();
  render(<CreateSeriesDialog isOpen onClose={close} />);
  fireEvent.change(screen.getByPlaceholderText('seriesTitlePlaceholder'), { target: { value: ' Test series ' } });
  fireEvent.click(screen.getByRole('button', { name: 'createSeries' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('createFailed');
  expect(close).not.toHaveBeenCalled();
  for (const [label, option] of [['workflowMode', 'workflowI2V'], ['contentMode', 'contentFreeform'], ['visualControlPref', 'visualControlI2V']]) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(option) }));
  }
  fireEvent.click(screen.getByRole('button', { name: 'createSeries' }));
  await waitFor(() => expect(create).toHaveBeenLastCalledWith('Test series', {
    description: undefined, workflow_mode: 'i2v_legacy', content_mode: 'freeform', default_generation_mode: 'i2v',
  }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});
