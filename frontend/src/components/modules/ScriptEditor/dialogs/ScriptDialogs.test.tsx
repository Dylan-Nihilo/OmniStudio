// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { scriptEditorApi } from '@/lib/scriptEditorApi';
import ImportDialog from './ImportDialog';
import ExportDialog from './ExportDialog';
import SnapshotListDialog from './SnapshotListDialog';
import type { Editor } from '@tiptap/react';
const translate = vi.hoisted(() => (key: string) => key);
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/lib/scriptEditorApi', () => ({ scriptEditorApi: { importDocument: vi.fn(), exportDocument: vi.fn(), listSnapshots: vi.fn(), restoreSnapshot: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());

it('requires confirmation to import and retains the selected file after a failed request', async () => {
  const close = vi.fn(); const imported = vi.fn();
  const content = { type: 'doc', content: [] };
  let fail!: (error: Error) => void;
  vi.mocked(scriptEditorApi.importDocument).mockReturnValueOnce(new Promise((_, reject) => { fail = reject; })).mockResolvedValue({ content });
  render(<ImportDialog open projectId="a" onClose={close} onImportSuccess={imported} />);
  const file = new File(['Draft'], 'draft.txt');
  fireEvent.change(screen.getByLabelText('dialogs.import.chooseFile', { selector: 'input' }), { target: { files: [file] } });
  expect(scriptEditorApi.importDocument).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'dialogs.import.title' }));
  expect(screen.getByRole('button', { name: 'close' })).toBeDisabled();
  await act(async () => fail(new Error('Connection lost')));
  expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
  expect(screen.getByText('draft.txt')).toBeVisible();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'dialogs.import.title' }));
  await waitFor(() => expect(imported).toHaveBeenCalledWith(content));
  expect(scriptEditorApi.importDocument).toHaveBeenLastCalledWith('a', file);
  expect(close).toHaveBeenCalledOnce();
});

it('rejects unsupported and oversized imports before requesting the API', () => {
  render(<ImportDialog open projectId="a" onClose={vi.fn()} onImportSuccess={vi.fn()} />);
  const input = screen.getByLabelText('dialogs.import.chooseFile', { selector: 'input' });
  fireEvent.change(input, { target: { files: [new File(['x'], 'script.exe')] } });
  expect(screen.getByRole('alert')).toHaveTextContent('dialogs.import.unsupportedType');
  const largeFile = new File(['x'], 'script.txt');
  Object.defineProperty(largeFile, 'size', { value: 11 * 1024 * 1024 });
  fireEvent.change(input, { target: { files: [largeFile] } });
  expect(screen.getByRole('alert')).toHaveTextContent('dialogs.import.fileTooLarge');
  expect(screen.getByRole('button', { name: 'dialogs.import.title' })).toBeDisabled();
  expect(scriptEditorApi.importDocument).not.toHaveBeenCalled();
});

it('reports a failed export and keeps every supported format available for retry', async () => {
  const close = vi.fn(); const content = { type: 'doc', content: [] };
  vi.mocked(scriptEditorApi.exportDocument).mockRejectedValue(new Error('Export unavailable'));
  render(<ExportDialog open projectId="a" onClose={close} editor={{ getJSON: () => content } as unknown as Editor} />);
  fireEvent.click(screen.getByRole('button', { name: /^PDF / }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Export unavailable');
  expect(scriptEditorApi.exportDocument).toHaveBeenCalledWith('a', content, 'pdf');
  for (const name of [/^Fountain /, /^Final Draft/, /^dialogs.export.txtLabel/, /^PDF /, /^DOCX /]) expect(screen.getByRole('button', { name })).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
});

it('distinguishes failed history loading from empty history and confirms restoration', async () => {
  const close = vi.fn(); const restored = vi.fn();
  const snapshot = { project_id: 'a', timestamp: 'version-1', created_at: '2026-09-06T01:00:00Z' };
  vi.mocked(scriptEditorApi.listSnapshots).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue([snapshot]);
  vi.mocked(scriptEditorApi.restoreSnapshot).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ project_id: 'a', content: { type: 'doc' }, updated_at: '' });
  render(<SnapshotListDialog open projectId="a" onClose={close} onRestore={restored} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('dialogs.snapshots.loadFailed');
  expect(screen.queryByText('snapshots.empty')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'shell.retryLoadDocument' }));
  fireEvent.click(await screen.findByRole('button', { name: 'dialogs.snapshots.restore' }));
  expect(scriptEditorApi.restoreSnapshot).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'dialogs.snapshots.confirmBtn' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('dialogs.snapshots.restoreFailed');
  expect(restored).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'dialogs.snapshots.confirmBtn' }));
  await waitFor(() => expect(restored).toHaveBeenCalledWith({ type: 'doc' }));
  expect(scriptEditorApi.restoreSnapshot).toHaveBeenLastCalledWith('a', 'version-1');
  expect(close).toHaveBeenCalledOnce();
});
