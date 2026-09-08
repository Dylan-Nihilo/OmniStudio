import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BookOpen, Film } from 'lucide-react';
import PipelineSidebar from './PipelineSidebar';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
it('keeps actual steps and status labels, permits gated navigation and returns to the parent series', () => {
  const navigate = vi.fn();
  render(<PipelineSidebar activeStep="script" onStepChange={navigate} projectLabel="Test episode" breadcrumbSegments={[{ label: 'Home', hash: '#/workspace' }, { label: 'Parent series', hash: '#/series/parent' }, { label: 'Episode' }]} steps={[
    { id: 'script', label: '1. Script', icon: BookOpen },
    { id: 'assembly', label: '2. Export', icon: Film, status: 'gated', statusLabel: 'Add shots to export' },
  ]} />);
  expect(screen.getByRole('row', { name: 'Script' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('row', { name: 'Export · Add shots to export' }));
  expect(navigate).toHaveBeenCalledWith('assembly');
  fireEvent.click(screen.getByRole('button', { name: 'Parent series' }));
  expect(window.location.hash).toBe('#/series/parent');
});
