import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/renderWithIntl';
import PreviewVideo from './PreviewVideo';

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

/** Fail the element the way a browser does: set `error`, then fire the event. */
function failWith(code: number) {
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'error', { value: { code }, configurable: true });
    fireEvent.error(video);
}

it('says why a video failed instead of only that it failed', () => {
    // The element knows the reason and the panel used to throw it away, so a decode failure,
    // a dropped connection and an unreachable file all read identically — there was nothing
    // for a user to act on and nothing for anyone to debug from.
    renderWithIntl(<PreviewVideo src="/video/take.mp4" alt="片段1" />);

    failWith(3);            // MEDIA_ERR_DECODE — first failure only triggers the auto-retry
    failWith(3);

    expect(screen.getByText('视频加载失败')).toBeVisible();
    expect(screen.getByText('文件已取到，但解码失败')).toBeVisible();
});

it('distinguishes a dropped connection from an unplayable file', () => {
    renderWithIntl(<PreviewVideo src="/video/take.mp4" alt="片段1" />);
    failWith(2);            // MEDIA_ERR_NETWORK
    failWith(2);
    expect(screen.getByText('网络中断，文件没有取完')).toBeVisible();
    expect(screen.queryByText('文件已取到，但解码失败')).not.toBeInTheDocument();
});

it('offers the file directly so a player problem can be told apart from a missing file', () => {
    renderWithIntl(<PreviewVideo src="/video/take.mp4" alt="片段1" />);
    failWith(4);
    failWith(4);
    const open = screen.getByRole('link', { name: '在新标签打开' });
    expect(open).toHaveAttribute('href', '/video/take.mp4');
    expect(open).toHaveAttribute('target', '_blank');
});

it('retries once on its own before giving up on the video', () => {
    renderWithIntl(<PreviewVideo src="/video/take.mp4" alt="片段1" />);
    failWith(2);
    // Still showing the player, now on a cache-busted URL rather than the failure panel.
    expect(document.querySelector('video')).toHaveAttribute('src', '/video/take.mp4?__r=1');
    expect(screen.queryByText('视频加载失败')).not.toBeInTheDocument();
});
