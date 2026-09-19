import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ImportAssetsDialog from './ImportAssetsDialog';

const { listSeries, getSeries, importSeriesAssets } = vi.hoisted(() => ({
  listSeries: vi.fn(),
  getSeries: vi.fn(),
  importSeriesAssets: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/lib/api', () => ({ api: { listSeries, getSeries, importSeriesAssets } }));
vi.mock('@/lib/characterImage', () => ({ characterImageUrl: () => undefined }));

const sourceSeries = {
  id: 'source-series',
  title: '素材系列',
  characters: [{ id: 'character-1', name: '主角', description: '角色' }],
  scenes: [],
  props: [],
};

it('keeps selected assets visible and allows retry when importing fails', async () => {
  const onClose = vi.fn();
  const onImported = vi.fn();
  listSeries.mockResolvedValueOnce([sourceSeries]);
  getSeries.mockResolvedValueOnce(sourceSeries);
  importSeriesAssets.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce({});

  render(<ImportAssetsDialog isOpen onClose={onClose} seriesId="target-series" onImported={onImported} />);

  const sourceButton = await screen.findByRole('button', { name: /素材系列/ });
  fireEvent.click(sourceButton);
  fireEvent.click(screen.getByRole('button', { name: 'next' }));

  const assetButton = await screen.findByRole('button', { name: /主角/ });
  fireEvent.click(assetButton);
  fireEvent.click(screen.getByRole('button', { name: 'next' }));
  fireEvent.click(screen.getByRole('button', { name: 'confirmImport' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('importFailed');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByText('主角')).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'confirmImport' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onImported).toHaveBeenCalledOnce();
});
