import { describe, expect, it } from 'vitest';

import { shouldShowLocalCacheHint } from './useOfflineCache';

describe('useOfflineCache hint visibility', () => {
  it('does not show the same cache hint again after it was dismissed', () => {
    const cacheTimestamp = 1_000;
    expect(shouldShowLocalCacheHint(cacheTimestamp, 2_000, 2_000)).toBe(false);
    expect(shouldShowLocalCacheHint(cacheTimestamp, 2_000, 999)).toBe(true);
  });
  it('does not offer a cache older than the saved server document', () => {
    expect(shouldShowLocalCacheHint(1_000, 4_000, null, 2_000)).toBe(false);
    expect(shouldShowLocalCacheHint(2_000, 4_000, null, 2_000)).toBe(false);
    expect(shouldShowLocalCacheHint(3_000, 4_000, null, 2_000)).toBe(true);
  });
});

it('recovers edits flushed on navigation and clears the recovery hint for another project', async () => {
  const { act, renderHook, waitFor } = await import('@testing-library/react');
  const { Editor } = await import('@tiptap/react');
  const { default: StarterKit } = await import('@tiptap/starter-kit');
  const { vi } = await import('vitest');
  const { useOfflineCache } = await import('./useOfflineCache');
  const stored = new Map<string, object>();
  const request = (result: unknown) => {
    const req = { result, onsuccess: null as null | (() => void) };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  vi.stubGlobal('indexedDB', { open: () => request({
    close: () => {},
    transaction: () => {
      const transaction = {
        oncomplete: null as null | (() => void),
        objectStore: () => ({
          get: (id: string) => request(stored.get(id)),
          put: (doc: { projectId: string }) => {
            stored.set(doc.projectId, structuredClone(doc));
            queueMicrotask(() => transaction.oncomplete?.());
          },
        }),
      };
      return transaction;
    },
  }) });
  const editor = new Editor({ extensions: [StarterKit], content: '<p>Saved draft</p>' });
  const saved = editor.getJSON();
  let unmount = () => {};
  try {
    const first = renderHook(() => useOfflineCache('recovery-a', editor, saved));
    act(() => editor.commands.setContent('<p>Unsaved revision</p>'));
    first.unmount();
    await act(async () => { await Promise.resolve(); });
    editor.commands.setContent(saved, { emitUpdate: false });
    const next = renderHook(({ id }) => useOfflineCache(id, editor, saved), { initialProps: { id: 'recovery-a' } });
    unmount = next.unmount;
    await waitFor(() => expect(next.result.current.hasNewerLocal).toBe(true));
    act(() => next.result.current.restoreFromLocal());
    expect(editor.getText()).toBe('Unsaved revision');
    expect(next.result.current.hasNewerLocal).toBe(false);
    next.rerender({ id: 'recovery-b' });
    expect(next.result.current.hasNewerLocal).toBe(false);
  } finally {
    unmount();
    editor.destroy();
    vi.unstubAllGlobals();
    localStorage.removeItem('omni_studio.script-editor.dismissed-cache:recovery-a');
  }
});
