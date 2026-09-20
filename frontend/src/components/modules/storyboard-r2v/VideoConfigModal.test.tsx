import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import VideoConfigModal, { DEFAULT_VIDEO_CONFIG } from './VideoConfigModal';

it('protects changed settings on close and applies the retained draft', async () => {
  const close = vi.fn();
  const apply = vi.fn();
  renderWithIntl(<VideoConfigModal isOpen config={DEFAULT_VIDEO_CONFIG} onClose={close} onConfigChange={apply} />);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: /^(取消|Cancel)$/ }));
  expect(await screen.findByRole('dialog', { name: '有未保存的修改' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /应用/ }));
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ duration: 8 }));
});
