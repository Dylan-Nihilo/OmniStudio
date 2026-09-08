import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ToastContainer from './ToastContainer';
import { useToastStore } from '@/store/toastStore';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
afterEach(() => { useToastStore.getState().clear(); vi.restoreAllMocks(); });

it('announces errors, reports clipboard failure, and runs the recovery action once', async () => {
  const action = vi.fn();
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard denied'));
  useToastStore.getState().push({ kind: 'error', title: 'Save failed', body: 'Keep the current draft. The server could not save the changes.', action: { label: 'Retry', onClick: action } });
  render(<ToastContainer />);
  expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
  fireEvent.click(screen.getByRole('button', { name: 'copyErrorDetails' }));
  expect(await screen.findByRole('button', { name: 'copyFailed' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(action).toHaveBeenCalledOnce();
  await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(0));
});
