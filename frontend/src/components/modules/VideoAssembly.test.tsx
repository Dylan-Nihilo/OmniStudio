import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ExportPhase, countReadyFrames, getAssemblyError } from './VideoAssembly';

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

it('extracts actionable merge errors without relying on a browser alert', () => {
  expect(getAssemblyError({ response: { data: { detail: '磁盘空间不足' } } }, '合片失败')).toBe('磁盘空间不足');
  expect(getAssemblyError(new Error('ffmpeg unavailable'), '合片失败')).toBe('ffmpeg unavailable');
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
}, 15_000);

it('offers an explicit retry action after a merge failure', () => {
  const onMerge = vi.fn();
  render(<ExportPhase mergedVideoUrl={null} isMerging={false} isDownloading={false} mergeError="ffmpeg failed" framesReady={1} framesTotal={1}
    exportSettings={{}} precheckReport={null} mergeProgress={null} mergeVerification={null}
    onSaveSettings={vi.fn()} onRunPrecheck={vi.fn()} onMerge={onMerge} onDownload={vi.fn()} onDismissError={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'retryMerge' }));
  expect(onMerge).toHaveBeenCalledTimes(1);
});

it('offers only portrait export resolutions for a portrait master canvas', () => {
  render(<ExportPhase masterAspectRatio="9:16" mergedVideoUrl={null} isMerging={false} isDownloading={false} mergeError={null} framesReady={0} framesTotal={0}
    exportSettings={{ resolution: '1920x1080' }} precheckReport={null} mergeProgress={null} mergeVerification={null}
    onSaveSettings={vi.fn()} onRunPrecheck={vi.fn()} onMerge={vi.fn()} onDownload={vi.fn()} onDismissError={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: /resolution/ }));
  expect(screen.getByRole('option', { name: '1080×1920' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: '720×1280' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: '1920×1080' })).not.toBeInTheDocument();
});

it('opens a flagged shot and keeps review retryable after a save error', async () => {
  const inspect = vi.fn();
  const review = vi.fn().mockRejectedValueOnce(new Error('Review was not saved')).mockResolvedValue(undefined);
  render(<ExportPhase mergedVideoUrl={null} isMerging={false} isDownloading={false} mergeError={null} framesReady={1} framesTotal={1}
    exportSettings={{}} precheckReport={{ ok: false, total_frames: 1, frames_with_video: 1,
      content_issues: [{ frame_id: 'shot', video_id: 'take', blocking: true, reviewable: true, reason: 'Reference changed' }] }} mergeProgress={null} mergeVerification={null}
    onSaveSettings={vi.fn()} onRunPrecheck={vi.fn()} onMerge={vi.fn()} onDownload={vi.fn()} onDismissError={vi.fn()}
    onInspectShot={inspect} onReviewShot={review} />);
  fireEvent.click(screen.getByRole('button', { name: 'reviewInspect' }));
  expect(inspect).toHaveBeenCalledWith('shot');
  fireEvent.click(screen.getByRole('button', { name: 'reviewKeep' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Review was not saved');
  fireEvent.click(screen.getByRole('button', { name: 'reviewKeep' }));
  await waitFor(() => expect(review).toHaveBeenCalledTimes(2));
  expect(review).toHaveBeenLastCalledWith('shot', 'take', undefined);
});

it('shows retained intermediate export context after a failed merge', () => {
  render(<ExportPhase mergedVideoUrl={null} isMerging={false} isDownloading={false} mergeError="ffmpeg failed" mergeFailure={{ stage: 'transcoding', intermediate_dir: 'tmp/export-1' }} framesReady={1} framesTotal={1}
    exportSettings={{}} precheckReport={null} mergeProgress={null} mergeVerification={null}
    onSaveSettings={vi.fn()} onRunPrecheck={vi.fn()} onMerge={vi.fn()} onDownload={vi.fn()} onDismissError={vi.fn()} />);

  expect(screen.getByText('retainedIntermediate')).toBeInTheDocument();
  expect(screen.getByText('tmp/export-1')).toBeInTheDocument();
});
