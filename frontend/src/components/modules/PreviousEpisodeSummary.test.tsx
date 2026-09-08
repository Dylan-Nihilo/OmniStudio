import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import PreviousEpisodeSummary from './PreviousEpisodeSummary';
import { api } from '@/lib/api';
vi.mock('next-intl', () => ({ useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}` }));
vi.mock('@/lib/api', () => ({ api: {
  getPreviousEpisodeSummary: vi.fn().mockResolvedValue({ has_previous: true, previous_episode_id: 'previous', previous_episode_title: 'Earlier episode', raw_snippet: 'A signal across the city', ai_summary: 'Cached summary', ai_summary_stale: false }),
  getNextEpisodeHook: vi.fn().mockResolvedValue({ has_text: true, hook: null, stale: false }),
  generatePreviousEpisodeSummary: vi.fn(), generateNextEpisodeHook: vi.fn(),
  updateLastEpisodeSummary: vi.fn().mockResolvedValue({}),
} }));
it('loads the previous text without generating and retains manual summary editing', async () => {
  render(<PreviousEpisodeSummary scriptId="current" />);
  expect(await screen.findByText('Cached summary')).toBeVisible();
  expect(screen.getByText('…A signal across the city')).toBeVisible();
  expect(api.generatePreviousEpisodeSummary).not.toHaveBeenCalled();
  expect(api.generateNextEpisodeHook).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'previousEpisode.editBtn' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'previousEpisode.editPlaceholder' }), { target: { value: 'Revised summary' } });
  fireEvent.click(screen.getByRole('button', { name: 'previousEpisode.editSave' }));
  await waitFor(() => expect(api.updateLastEpisodeSummary).toHaveBeenCalledWith('current', 'Revised summary'));
  expect(await screen.findByText('Revised summary')).toBeVisible();
});
