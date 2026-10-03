import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import AudioModeSelector from './AudioModeSelector';

it('offers the two main workflows and disables unsupported native audio', () => {
    const change = vi.fn();
    renderWithIntl(<AudioModeSelector policy={{ mode: 'post', original_audio: 'drop' }}
        capabilities={{ modes: ['post', 'silent'], backend: 'test', can_disable_native: true }} onChange={change} />);
    expect(screen.getByRole('radio', { name: '后期配音' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '模型原声' })).toBeDisabled();
    fireEvent.click(screen.getByText('更多声音方式'));
    fireEvent.click(screen.getByRole('radio', { name: '无声' }));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ mode: 'silent' }));
});

it('keeps an incompatible selection visible instead of changing it', () => {
    renderWithIntl(<AudioModeSelector policy={{ mode: 'native', original_audio: 'drop' }}
        capabilities={{ modes: ['post', 'silent'], backend: 'test', can_disable_native: false }} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: '模型原声' })).toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent('不支持');
});
