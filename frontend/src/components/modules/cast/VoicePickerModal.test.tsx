import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import VoicePickerModal from './VoicePickerModal';

const { remove } = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ api: {
  getVoices: vi.fn().mockResolvedValue([]),
  recommendVoices: vi.fn().mockResolvedValue({ recommendations: [] }),
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

it('shows explainable voice recommendations without binding before Apply', async () => {
  const api = await import('@/lib/api');
  vi.mocked(api.api.getVoices).mockResolvedValueOnce([{
    id: 'voice-female', name: 'Female', gender: 'Female', model: 'cosyvoice-v2', family: 'cosyvoice',
    supports_instruction: true, origin: 'system', dialect: null, lang_primary: null,
  }]);
  vi.mocked(api.api.recommendVoices).mockResolvedValueOnce({
    recommendations: [{ voice_id: 'voice-female', name: 'Female', score: 90, reasons: ['gender_match'] }],
    selection_requires_confirmation: true,
  });
  const apply = vi.fn();
  render(<VoicePickerModal isOpen onClose={vi.fn()} characterName="Rae" characterGender="Female" onApply={apply} />);
  expect((await screen.findAllByText('recommendationReasons.gender_match'))[0]).toBeVisible();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click((screen.getAllByText('Female')[0]).closest('div.relative')!);
  fireEvent.click(screen.getByRole('button', { name: 'apply' }));
  expect(apply).toHaveBeenCalledWith('voice-female', 'Female');
});
