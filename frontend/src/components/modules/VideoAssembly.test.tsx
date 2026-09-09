import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ExportPhase } from './VideoAssembly';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

it('saves numeric export values and clears optional resolution and fps through the component picker', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ExportPhase mergedVideoUrl={null} isMerging={false} isDownloading={false} mergeError={null} framesReady={0} framesTotal={0}
    exportSettings={{ resolution: '1920x1080', fps: 30, crf: 20, preset: 'medium', audio_bitrate: '192k', subtitles: 'none' }} precheckReport={null} mergeProgress={null} mergeVerification={null}
    onSaveSettings={save} onRunPrecheck={vi.fn()} onMerge={vi.fn()} onDownload={vi.fn()} onDismissError={vi.fn()} />);
  for (const [label, option] of [['resolution', '—'], ['fps', '25'], ['crf', '23'], ['preset', 'slow'], ['audioBitrate', '256k'], ['subtitles', 'soft']]) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    fireEvent.click(await screen.findByRole('option', { name: option }));
  }
  fireEvent.click(screen.getByRole('button', { name: 'saveSettings' }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith({ resolution: null, fps: 25, crf: 23, preset: 'slow', audio_bitrate: '256k', subtitles: 'soft' }));
  fireEvent.click(screen.getByRole('button', { name: /fps/ }));
  fireEvent.click(await screen.findByRole('option', { name: '—' }));
  fireEvent.click(screen.getByRole('button', { name: 'saveSettings' }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ fps: null })));
});

it('offers an explicit retry action after a merge failure', () => {
  const onMerge = vi.fn();
  render(<ExportPhase mergedVideoUrl={null} isMerging={false} isDownloading={false} mergeError="ffmpeg failed" framesReady={1} framesTotal={1}
    exportSettings={{}} precheckReport={null} mergeProgress={null} mergeVerification={null}
    onSaveSettings={vi.fn()} onRunPrecheck={vi.fn()} onMerge={onMerge} onDownload={vi.fn()} onDismissError={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'retryMerge' }));
  expect(onMerge).toHaveBeenCalledTimes(1);
});
