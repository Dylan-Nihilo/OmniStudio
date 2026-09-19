import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ProjectSettings from './ProjectSettings';

const { updateProjectStyle } = vi.hoisted(() => ({
  updateProjectStyle: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}: ${values.error}` : key,
}));
vi.mock('@/lib/api', () => ({ api: { updateProjectStyle } }));

it('keeps style edits visible and allows retry when saving fails', async () => {
  const onClose = vi.fn();
  const onUpdate = vi.fn();
  updateProjectStyle
    .mockRejectedValueOnce(new Error('network unavailable'))
    .mockResolvedValueOnce({ id: 'project-1', style_prompt: 'soft light' });

  render(
    <ProjectSettings
      project={{ id: 'project-1', style_preset: 'realistic', style_prompt: 'soft light' }}
      isOpen
      onClose={onClose}
      onUpdate={onUpdate}
    />,
  );

  const prompt = screen.getByRole('textbox');
  fireEvent.change(prompt, { target: { value: 'neon rim light' } });
  fireEvent.click(screen.getByRole('button', { name: 'saveSettings' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('updateFailedDetail: network unavailable');
  expect(prompt).toHaveValue('neon rim light');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'saveSettings' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'saveSettings' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onUpdate).toHaveBeenCalledWith({ id: 'project-1', style_prompt: 'soft light' });
});
