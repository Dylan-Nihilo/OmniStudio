import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import zh from '../../../../messages/zh.json';
import OmniReferenceSection from './OmniReferenceSection';
import type { OmniReferenceSettings } from '@/lib/omniReferences';
import { frameToShotNode } from './shotNodeHelpers';

const { upload, changed, pending } = vi.hoisted(() => ({ upload: vi.fn(), changed: vi.fn(), pending: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { uploadFile: upload } }));
vi.mock('@/lib/utils', () => ({ getAssetUrl: (url: string) => url }));
function Editor({ initial, supported = true }: { initial?: OmniReferenceSettings; supported?: boolean }) {
    const [value, setValue] = useState<OmniReferenceSettings>(initial ?? { videos: [], audios: [], audio_mode: 'post' });
    return <NextIntlClientProvider locale="zh" messages={zh}><OmniReferenceSection value={value} supported={supported}
        imageCount={6} onChange={next => { changed(next); setValue(next); }} onPendingChange={pending} /></NextIntlClientProvider>;
}
beforeEach(() => vi.resetAllMocks());

it('adds, previews, describes and removes video references', () => {
    const view = render(<Editor />);
    fireEvent.change(screen.getByLabelText('视频参考地址'), { target: { value: 'https://example.test/action.mp4' } });
    fireEvent.click(screen.getByRole('button', { name: '添加视频参考' }));
    expect(view.container.querySelector('video')).toHaveAttribute('src', 'https://example.test/action.mp4');
    fireEvent.change(screen.getByRole('textbox', { name: '参考用途' }), { target: { value: '只参考挡路动作' } });
    expect(changed.mock.lastCall?.[0].videos[0].purpose).toBe('只参考挡路动作');
    fireEvent.click(screen.getByRole('button', { name: '移除视频参考 1' }));
    expect(changed.mock.lastCall?.[0].videos).toEqual([]);
});

it('rejects invalid URLs and switches to reference audio only after attaching audio', () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText('音频参考地址'), { target: { value: 'http://localhost/voice.wav' } });
    fireEvent.click(screen.getByRole('button', { name: '添加音频参考' }));
    expect(screen.getByRole('alert')).toHaveTextContent('HTTPS');
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('音频参考地址'), { target: { value: 'https://example.test/voice.wav' } });
    fireEvent.click(screen.getByRole('button', { name: '添加音频参考' }));
    const saved = changed.mock.lastCall?.[0];
    expect(saved.audio_mode).toBe('driven');
    expect(frameToShotNode({ id: 'shot', omni_reference_settings: saved }, []).omniReferences).toEqual(saved);
    fireEvent.click(screen.getByRole('button', { name: '移除音频参考 1' }));
    expect(changed.mock.lastCall?.[0]).toMatchObject({ audio_mode: 'post', audios: [] });
});

it('uploads a local video and does not apply a late upload to another shot', async () => {
    let finish!: (value: { url: string }) => void;
    upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<Editor />);
    fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [new File(['video'], 'action.mp4', { type: 'video/mp4' })] } });
    expect(pending).toHaveBeenCalledWith(true);
    view.unmount();
    await act(async () => { finish({ url: 'uploads/workspace/action.mp4' }); });
    expect(changed).not.toHaveBeenCalled();
    expect(pending).toHaveBeenLastCalledWith(false);
});

it('lets unsupported models clear saved references instead of silently discarding them', () => {
    render(<Editor supported={false} initial={{ videos: [{ url: 'https://example.test/a.mp4', purpose: '' }], audios: [], audio_mode: 'native' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Seedance 2.5');
    fireEvent.click(screen.getByRole('button', { name: '清空全能参考设置' }));
    expect(changed.mock.lastCall?.[0]).toEqual({ videos: [], audios: [], audio_mode: 'post' });
});
