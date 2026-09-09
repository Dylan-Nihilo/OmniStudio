import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/apiClient';
import ExportDialog from './ExportDialog';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: Record<string, string>) => values?.filename || key }));
const originalAdapter = apiClient.defaults.adapter;
afterEach(() => { apiClient.defaults.adapter = originalAdapter; vi.restoreAllMocks(); });

it.each([
  ['PDF', 'text/html', 'script.html', '<html>末班信号</html>'],
  ['DOCX', 'text/plain', 'script.txt', '末班信号'],
])('downloads the actual %s fallback format and tells the user', async (label, mime, filename, body) => {
  apiClient.defaults.adapter = async config => ({
    config, status: 200, statusText: 'OK', data: new Blob([body], { type: mime }),
    headers: { 'content-type': mime, 'content-disposition': `attachment; filename="${filename}"`, 'x-export-fallback': 'true' },
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-export');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
  const editor = new Editor({ extensions: [StarterKit], content: '<p>末班信号</p>' });
  const close = vi.fn();
  const view = render(<ExportDialog open projectId="e2e" onClose={close} editor={editor} />);
  try {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label} `) }));
    await waitFor(() => expect(names).toEqual([filename]));
    expect(screen.getByRole('status')).toHaveTextContent(filename);
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: new RegExp(`^${label} `) })).toBeEnabled();
  } finally { view.unmount(); editor.destroy(); }
});
