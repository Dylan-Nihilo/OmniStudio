import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/renderWithIntl';
import PreviewImage from './PreviewImage';

vi.mock('@/lib/utils', () => ({ getAssetUrl: (value?: string) => value || '' }));

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 640, height: 360, top: 0, left: 0, right: 640, bottom: 360,
        x: 0, y: 0, toJSON: () => ({}),
    });
});

it('keeps the image preview control readable over dark artwork', () => {
    renderWithIntl(<PreviewImage src="/dark-frame.png" alwaysShowMagnify alt="分镜" />);

    const button = screen.getByRole('button', { name: '放大查看' });
    expect(button).toHaveClass('bg-white/90', 'text-black', 'border-white/70');
    expect(button).not.toHaveClass('opacity-0');
});
