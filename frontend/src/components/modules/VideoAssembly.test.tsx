import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ExportPhase, countReadyFrames } from './VideoAssembly';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

it('counts only explicitly selected completed takes with a video URL', () => {
  const frames = [
    { id: 'ready', selected_video_id: 'task-ready' },
    { id: 'failed', selected_video_id: 'task-failed' },
    { id: 'missing', selected_video_id: 'task-missing' },
    { id: 'unselected', selected_video_id: null },
  ];
  const tasks = [
    { id: 'task-ready', status: 'completed', video_url: '/ready.mp4' },
    { id: 'task-failed', status: 'failed', video_url: '/failed.mp4' },
    { id: 'task-missing', status: 'completed', video_url: null },
  ];

  expect(countReadyFrames(frames, tasks)).toBe(1);
});

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

it('shows retained intermediate export context after a failed merge', () => {
  render(<ExportPhase mergedVideoUrl={null} isMerging={false} isDownloading={false} mergeError="ffmpeg failed" mergeFailure={{ stage: 'transcoding', intermediate_dir: 'tmp/export-1' }} framesReady={1} framesTotal={1}
    exportSettings={{}} precheckReport={null} mergeProgress={null} mergeVerification={null}
    onSaveSettings={vi.fn()} onRunPrecheck={vi.fn()} onMerge={vi.fn()} onDownload={vi.fn()} onDismissError={vi.fn()} />);

  expect(screen.getByText('retainedIntermediate')).toBeInTheDocument();
  expect(screen.getByText('tmp/export-1')).toBeInTheDocument();
});
