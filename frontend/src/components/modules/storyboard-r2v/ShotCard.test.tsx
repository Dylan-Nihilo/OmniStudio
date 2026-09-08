import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ShotCard, { type ShotNode } from './ShotCard';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: { count?: number }) => key + (values?.count ? ` ${values.count}` : '') }));
vi.mock('@/components/shared/preview/PreviewImage', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('@/components/shared/preview/PreviewVideo', () => ({ default: () => <video /> }));
vi.mock('./PolishPanel', () => ({ default: () => null }));
it('uses the storyboard image before video, preserves settings slots and routes shot actions', () => {
  const update = vi.fn(), generate = vi.fn(), duplicate = vi.fn();
  const shot: ShotNode = { id: 'frame-a', prompt: 'City at dusk', tabMode: 'direct_r2v', imageUrl: '/frame.png' };
  render(<ShotCard shot={shot} index={0} totalShots={2} characters={[]} scenes={[]} props={[]}
    onUpdatePrompt={update} onUpdateField={vi.fn()} onGenerateT2I={vi.fn()} onGenerateVideo={vi.fn()} onDelete={vi.fn()}
    onMoveUp={vi.fn()} onMoveDown={vi.fn()} onDuplicate={duplicate} onSetTabMode={vi.fn()} onOpenDrawer={vi.fn()} onInsertAsset={vi.fn()}
    generateCount={4} onGenerateBatch={generate} sequence={<p>Sequence slot</p>} configuration={<p>Parameters slot</p>} candidates={<p>Candidates slot</p>} />);
  expect(screen.getByRole('img')).toHaveAttribute('src', '/frame.png');
  expect(screen.getByText('Sequence slot')).toBeVisible();
  expect(screen.getByText('Parameters slot')).toBeVisible();
  expect(screen.getByText('Candidates slot')).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'promptLabel' }), { target: { value: 'Updated action' } });
  expect(update).toHaveBeenCalledWith('Updated action');
  fireEvent.click(screen.getByRole('button', { name: 'generateBatch 4' }));
  expect(generate).toHaveBeenCalledWith(4);
  fireEvent.click(screen.getByRole('button', { name: 'shotActions' }));
  expect(screen.getByRole('menuitem', { name: 'moveUp' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('menuitem', { name: 'duplicateShot' }));
  expect(duplicate).toHaveBeenCalledOnce();
});
