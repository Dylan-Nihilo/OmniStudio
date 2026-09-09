import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ReconcileModal from './ReconcileModal';
import { api } from '@/lib/api';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, getReconcileSuggestions: vi.fn(), applyReconcile: vi.fn() } };
});
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: { div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div> },
}));

it('shows confidence and local-versus-series differences for each suggestion', async () => {
  vi.mocked(api.getReconcileSuggestions).mockResolvedValueOnce({
    characters: [{
      local_id: 'local-hero',
      local_name: 'Hero',
      suggested_series_id: 'series-hero',
      suggested_series_name: 'Hero',
      confidence: 100,
      differences: [{ field: 'description', local_value: 'Red coat', series_value: 'Blue coat' }],
    }],
    scenes: [],
    props: [],
  });

  render(<ReconcileModal isOpen scriptId="episode-1" onClose={vi.fn()} />);

  await waitFor(() => expect(screen.getByText('100%')).toBeVisible());
  expect(screen.getByLabelText('differences')).toHaveTextContent('difference_description');
  expect(screen.getByLabelText('differences')).toHaveTextContent('Red coat');
  expect(screen.getByLabelText('differences')).toHaveTextContent('Blue coat');
});
