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

it('is marked as a React Aria top layer so its buttons stay clickable', () => {
  // Without this attribute a click on a toast is read as a click *outside* whichever
  // overlay is open: React Aria's interact-outside handling takes the event and the
  // dismiss button never sees it, so the toast is visible with a close button that does
  // nothing. That is what happened to the "generating" and "generation failed" toasts
  // during character image generation. The attribute is invisible and easy to drop in a
  // refactor, which is why it is pinned here.
  useToastStore.getState().push({ kind: 'progress', title: 'Generating', autoCloseMs: 0 });
  const { container } = render(<ToastContainer />);
  expect(container.firstElementChild).toHaveAttribute('data-react-aria-top-layer', 'true');
});

it('closes a progress toast when its dismiss button is pressed', async () => {
  // Reported from production: the "generation started" and "generation failed" toasts that
  // appear while a character image renders could not be closed at all.
  useToastStore.getState().push({ kind: 'progress', title: 'Generating', autoCloseMs: 0 });
  render(<ToastContainer />);
  expect(screen.getByText('Generating')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));
  await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(0));
});

it('closes a sticky error toast when its dismiss button is pressed', async () => {
  useToastStore.getState().push({ kind: 'error', title: 'Generation failed', autoCloseMs: 0 });
  render(<ToastContainer />);

  fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));
  await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(0));
});
