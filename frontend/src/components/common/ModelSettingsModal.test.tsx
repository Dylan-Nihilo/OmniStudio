import { renderWithIntl as render } from '@/test/renderWithIntl';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import ModelSettingsModal from './ModelSettingsModal';

const { updateModelSettings, updateProject, projectFixture } = vi.hoisted(() => ({
  updateModelSettings: vi.fn().mockResolvedValue({
    id: 'episode-1',
    model_settings: { i2v_model: 'happyhorse-1.1-i2v' },
    model_settings_sources: { i2v_model: 'global' },
  }),
  updateProject: vi.fn(),
  projectFixture: {
    id: 'episode-1',
    series_id: 'series-1',
    model_settings: {
      t2i_model: 'wan2.7-image',
      i2i_model: 'wan2.7-image',
      i2v_model: 'happyhorse-1.1-i2v',
      r2v_model: 'happyhorse-1.1-r2v',
      character_aspect_ratio: '16:9',
      scene_aspect_ratio: '16:9',
      prop_aspect_ratio: '16:9',
      storyboard_aspect_ratio: '16:9',
    },
    model_settings_overrides: { i2v_model: 'happyhorse-1.1-i2v' },
    model_settings_sources: { i2v_model: 'episode' },
  },
}));


vi.mock('@omnistudio/ui', () => ({
  Dialog: ({ isOpen, title, children, footer }: { isOpen: boolean; title: ReactNode; children: ReactNode; footer?: ReactNode }) => isOpen ? (
    <div role="dialog" aria-modal="true">
      <h2>{title}</h2>
      {children}
      {footer}
    </div>
  ) : null,
}));
vi.mock('@/lib/api', () => ({ api: { updateModelSettings } }));
vi.mock('@/store/projectStore', () => ({
  IMAGE_MODELS: [{ id: 'wan2.7-image', name: 'Image' }],
  I2V_MODELS: [{ id: 'happyhorse-1.1-i2v', name: 'HappyHorse I2V' }],
  ASPECT_RATIOS: [{ id: '16:9', name: '16:9', description: 'wide' }],
  useProjectStore: (selector: (state: unknown) => unknown) => selector({
    currentProject: projectFixture,
    updateProject,
  }),
}));
vi.mock('@/components/common/GroupedModelGrid', () => ({
  default: ({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) => (
    <button type="button" aria-label={`model-${selectedId}`} onClick={() => onSelect('happyhorse-1.1-i2v')}>
      model
    </button>
  ),
}));

it('restores an episode to inherited model settings instead of persisting parent values as overrides', async () => {
  render(<ModelSettingsModal isOpen onClose={vi.fn()} />);

  expect(screen.getByRole('button', { name: '恢复继承模型' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '恢复继承模型' }));
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

  await vi.waitFor(() => expect(updateModelSettings).toHaveBeenCalledWith(
    'episode-1',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    expect.arrayContaining(['image_model', 'i2v_model']),
  ));
});

it('renders generation settings as a dialog with a visible backdrop', () => {
  render(<ModelSettingsModal isOpen onClose={vi.fn()} />);

  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toBeVisible();
});

it('labels storyboard ratio as the master output canvas ratio', () => {
  render(<ModelSettingsModal isOpen onClose={vi.fn()} />);

  expect(screen.getByText('成片/分镜画幅')).toBeInTheDocument();
  expect(screen.getByText('继承：图生视频、参考生视频、分镜预览、最终合成')).toBeInTheDocument();
});

it('keeps model edits visible and allows retry when saving fails', async () => {
  const onClose = vi.fn();
  updateModelSettings
    .mockRejectedValueOnce(new Error('network unavailable'))
    .mockResolvedValueOnce({ id: 'episode-1' });

  render(<ModelSettingsModal isOpen onClose={onClose} />);

  fireEvent.click(screen.getByRole('button', { name: '恢复继承模型' }));
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('保存设置失败');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
