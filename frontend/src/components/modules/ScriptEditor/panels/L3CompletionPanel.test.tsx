import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import L3CompletionPanel from './L3CompletionPanel';
import { useEditorStore } from '@/store/editorStore';

const syncDerivation = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/lib/scriptEditorApi', () => ({
  scriptEditorApi: { syncDerivation },
}));

beforeEach(() => {
  syncDerivation.mockClear();
  useEditorStore.setState({
    projectId: 'project-1',
    l3Status: 'success',
    l3Results: [
      { type: 'character', name: 'Mina', description: 'A pilot', confidence: 0.92 },
      { type: 'prop', name: 'Brass key', description: 'A worn key', confidence: 0.81 },
    ],
    derivedScenes: [],
    derivedCharacters: [],
    estimatedDuration: 60,
    wordCount: 120,
  });
});

it('accepts one AI supplement and persists it without accepting the other suggestions', async () => {
  render(<L3CompletionPanel />);

  fireEvent.click(screen.getByRole('button', { name: 'panels.aiAccept: Mina' }));

  await waitFor(() => expect(syncDerivation).toHaveBeenCalledWith('project-1', expect.objectContaining({
    characters: [expect.objectContaining({ name: 'Mina' })],
    l3_supplements: [expect.objectContaining({ name: 'Mina', type: 'character' })],
  })));
  expect(screen.queryByText('Mina')).not.toBeInTheDocument();
  expect(screen.getByText('Brass key')).toBeInTheDocument();
  expect(useEditorStore.getState().derivedCharacters).toEqual([
    expect.objectContaining({ name: 'Mina', occurrences: 1 }),
  ]);
});

it('rejects one AI supplement without persisting it', () => {
  render(<L3CompletionPanel />);

  fireEvent.click(screen.getByRole('button', { name: 'panels.aiReject: Mina' }));

  expect(screen.queryByText('Mina')).not.toBeInTheDocument();
  expect(screen.getByText('Brass key')).toBeInTheDocument();
  expect(syncDerivation).not.toHaveBeenCalled();
});
