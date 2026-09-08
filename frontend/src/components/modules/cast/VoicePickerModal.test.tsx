import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import VoicePickerModal from './VoicePickerModal';

const { remove } = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ api: {
  getVoices: vi.fn().mockResolvedValue([]),
  listCustomVoices: vi.fn().mockResolvedValue([{ id: 'voice', label: 'My voice', origin: 'clone', target_model: 'cosyvoice-v2' }]),
  deleteCustomVoice: remove,
} }));
vi.mock('./VoiceCloneModal', () => ({ default: () => null }));
vi.mock('./VoiceDesignModal', () => ({ default: () => null }));

it('asks in an app dialog before deleting a voice and retains it after a failure', async () => {
  remove.mockRejectedValue(new Error('offline'));
  render(<VoicePickerModal isOpen onClose={vi.fn()} characterName="Rae" seriesId="series" onApply={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'tabClone' }));
  await screen.findByText('My voice');
  fireEvent.click(screen.getByRole('button', { name: 'Delete custom voice' }));
  const dialog = await screen.findByRole('dialog', { name: 'delete' });
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'confirm' }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith('series', 'voice'));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('deleteFailed');
  fireEvent.click(within(dialog).getByRole('button', { name: 'cancel' }));
  expect(await screen.findByText('My voice')).toBeVisible();
});
