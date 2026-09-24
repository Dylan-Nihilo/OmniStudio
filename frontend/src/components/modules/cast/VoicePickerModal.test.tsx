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
  fireEvent.click(screen.getByRole('button', { name: 'deleteCustomVoice' }));
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
  fireEvent.click((screen.getAllByText(/gender\.female/)[0]).closest('div.relative')!);
  fireEvent.click(screen.getByRole('button', { name: 'apply' }));
  expect(apply).toHaveBeenCalledWith('voice-female', 'Female');
});

it('lets creators select a Qwen Audio voice from the system catalog', async () => {
  const { api } = await import('@/lib/api');
  vi.mocked(api.getVoices).mockResolvedValueOnce([{
    id: 'longanlingxin', name: '龙安灵心', gender: 'Female', model: 'qwen-audio-3.0-tts-plus',
    family: 'qwen_audio', supports_instruction: true, origin: 'system',
  }]);
  const apply = vi.fn();
  render(<VoicePickerModal isOpen onClose={vi.fn()} characterName="Joan" onApply={apply} />);
  fireEvent.click((await screen.findByText('龙安灵心')).closest('div.relative')!);
  fireEvent.click(screen.getByRole('button', { name: 'apply' }));
  expect(apply).toHaveBeenCalledWith('longanlingxin', '龙安灵心');
});


it('keeps the selected voice and dialog open when applying fails, then retries', async () => {
  const {api} = await import('@/lib/api');
  vi.mocked(api.getVoices).mockResolvedValueOnce([{id:'v',name:'Voice test',family:'cosyvoice',origin:'system'}] as any);
  const close=vi.fn(), apply=vi.fn().mockRejectedValueOnce(new Error('save offline')).mockResolvedValue(undefined);
  render(<VoicePickerModal isOpen onClose={close} characterName="Rae" onApply={apply} />);
  fireEvent.click((await screen.findByText('Voice test')).closest('div.relative')!);
  fireEvent.click(screen.getByRole('button',{name:'apply'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('save offline');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'apply'}));
  await waitFor(()=>expect(close).toHaveBeenCalledOnce());
  expect(apply).toHaveBeenCalledTimes(2);
});

it('localizes voice metadata and the retry action', async () => {
  const { api } = await import('@/lib/api');
  vi.mocked(api.getVoices).mockResolvedValueOnce([{
    id: 'voice-female', name: 'Female', gender: 'Female', model: 'cosyvoice-v2', family: 'cosyvoice',
    supports_instruction: true, origin: 'system', dialect: 'shanghai', lang_primary: null,
  }]);
  render(<VoicePickerModal isOpen onClose={vi.fn()} characterName="Rae" onApply={vi.fn()} />);
  expect(await screen.findByText(/gender\.female/)).toBeVisible();
  expect(screen.getByText(/dialect\.shanghai/)).toBeVisible();
  expect(screen.getByText(/instructionTag/)).toBeVisible();
});

it('uses the common retry translation when loading voices fails', async () => {
  const { api } = await import('@/lib/api');
  vi.mocked(api.getVoices).mockRejectedValueOnce(new Error('offline'));
  render(<VoicePickerModal isOpen onClose={vi.fn()} characterName="Rae" onApply={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'retry' })).toBeVisible();
});
