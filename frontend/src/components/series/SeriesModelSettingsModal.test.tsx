import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SeriesModelSettingsModal from './SeriesModelSettingsModal';

const { getEffectiveSeriesModelSettings, updateSeriesModelSettings } = vi.hoisted(() => ({
  getEffectiveSeriesModelSettings: vi.fn().mockResolvedValue({
    settings: {
      t2i_model: 'wan2.7-image',
      i2i_model: 'wan2.7-image',
      i2v_model: 'happyhorse-1.1-i2v',
      r2v_model: 'happyhorse-1.1-r2v',
      character_aspect_ratio: '16:9',
      scene_aspect_ratio: '16:9',
      prop_aspect_ratio: '16:9',
      storyboard_aspect_ratio: '16:9',
    },
    sources: {
      t2i_model: 'global',
      i2i_model: 'global',
      i2v_model: 'project',
      r2v_model: 'global',
      character_aspect_ratio: 'global',
      scene_aspect_ratio: 'global',
      prop_aspect_ratio: 'global',
      storyboard_aspect_ratio: 'global',
    },
  }),
  updateSeriesModelSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ api: { getEffectiveSeriesModelSettings, updateSeriesModelSettings } }));
vi.mock('@/store/projectStore', () => ({
  ASPECT_RATIOS: [{ id: '16:9', name: '16:9', description: 'wide' }],
}));
vi.mock('@/lib/modelCatalog', () => ({
  SERIES_IMAGE_MODELS: [{ id: 'wan2.7-image', name: 'Image' }],
  SERIES_I2V_MODELS: [{ id: 'happyhorse-1.1-i2v', name: 'I2V' }],
  SERIES_R2V_MODELS: [{ id: 'happyhorse-1.1-r2v', name: 'R2V' }],
  resolveModelSettings: (settings: any) => ({
    t2i_model: settings?.t2i_model ?? 'wan2.7-image',
    i2i_model: settings?.i2i_model ?? 'wan2.7-image',
    i2v_model: settings?.i2v_model ?? 'happyhorse-1.1-i2v',
    r2v_model: settings?.r2v_model ?? 'happyhorse-1.1-r2v',
    character_aspect_ratio: settings?.character_aspect_ratio ?? '16:9',
    scene_aspect_ratio: settings?.scene_aspect_ratio ?? '16:9',
    prop_aspect_ratio: settings?.prop_aspect_ratio ?? '16:9',
    storyboard_aspect_ratio: settings?.storyboard_aspect_ratio ?? '16:9',
  }),
}));
vi.mock('@/components/common/GroupedModelGrid', () => ({
  default: ({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) => (
    <button type="button" aria-label={`model-${selectedId}`} onClick={() => onSelect(selectedId)}>
      model
    </button>
  ),
}));

it('loads effective settings and restores only the project fields to Workspace inheritance', async () => {
  render(<SeriesModelSettingsModal isOpen onClose={vi.fn()} seriesId="series-1" />);

  const resetButton = await screen.findByRole('button', { name: 'resetModelInheritance' });
  await waitFor(() => expect(resetButton).toBeVisible());
  fireEvent.click(resetButton);
  fireEvent.click(screen.getByRole('button', { name: 'saveSettings' }));

  await waitFor(() => expect(updateSeriesModelSettings).toHaveBeenCalledWith('series-1', expect.objectContaining({
    reset_fields: expect.arrayContaining(['image_model', 'i2v_model', 'r2v_model']),
  })));
  const payload = updateSeriesModelSettings.mock.calls.at(-1)?.[1];
  expect(payload).not.toHaveProperty('i2v_model');
  expect(payload).not.toHaveProperty('r2v_model');
});
