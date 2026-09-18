import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ShotCard, { type ShotNode } from './ShotCard';
import { useState } from 'react';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: { count?: number; name?: string }) => key + (values?.name ? ` ${values.name}` : values?.count ? ` ${values.count}` : '') }));
vi.mock('@/components/shared/preview/PreviewImage', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('@/components/shared/preview/PreviewVideo', () => ({ default: () => <video /> }));
vi.mock('./PolishPanel', () => ({ default: () => null }));
it('uses the storyboard image before video, exposes shot actions and confirms deletion', async () => {
  const update = vi.fn(), generate = vi.fn(), duplicate = vi.fn(), remove = vi.fn();
  const shot: ShotNode = { id: 'frame-a', prompt: 'City at dusk', tabMode: 'direct_r2v', imageUrl: '/frame.png' };
  render(<ShotCard shot={shot} index={0} totalShots={2} characters={[]} scenes={[]} props={[]}
    onUpdatePrompt={update} onUpdateField={vi.fn()} onGenerateT2I={vi.fn()} onGenerateVideo={vi.fn()} onDelete={remove}
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
  expect(screen.getByRole('button', { name: 'moveUp' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'duplicateShot' }));
  expect(duplicate).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'deleteShot' }));
  expect(remove).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('deleteShotConfirmBody')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'deleteShot' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'deleteShot' }));
  expect(remove).toHaveBeenCalledOnce();
});

it('shows a completed video as ready instead of asking the creator to generate it again', () => {
  render(<ShotCard shot={{ id: 'complete', prompt: 'Rain pavilion', tabMode: 'direct_r2v', videoUrl: '/take.mp4', videoStatus: 'completed' }}
    index={0} totalShots={1} characters={[]} scenes={[]} props={[]}
    onUpdatePrompt={vi.fn()} onUpdateField={vi.fn()} onGenerateT2I={vi.fn()} onGenerateVideo={vi.fn()} onDelete={vi.fn()}
    onMoveUp={vi.fn()} onMoveDown={vi.fn()} onDuplicate={vi.fn()} onSetTabMode={vi.fn()} onOpenDrawer={vi.fn()} onInsertAsset={vi.fn()} />);
  expect(screen.getByText('statusVideoReady')).toBeVisible();
  expect(screen.queryByText('statusReady')).not.toBeInTheDocument();
});

it('resets pane scrolling and dismisses deletion when the selected shot changes', async () => {
  const props = { index: 0, totalShots: 2, characters: [], scenes: [], props: [],
    onUpdatePrompt: vi.fn(), onUpdateField: vi.fn(), onGenerateT2I: vi.fn(), onGenerateVideo: vi.fn(), onDelete: vi.fn(),
    onMoveUp: vi.fn(), onMoveDown: vi.fn(), onDuplicate: vi.fn(), onSetTabMode: vi.fn(), onOpenDrawer: vi.fn(), onInsertAsset: vi.fn() };
  const shot: ShotNode = { id: 'first', prompt: 'First shot', tabMode: 'direct_r2v' };
  const view = render(<ShotCard {...props} shot={shot} />);
  screen.getByRole('region', { name: 'shotPreview' }).scrollTop = 240;
  screen.getByRole('complementary').scrollTop = 500;
  fireEvent.click(screen.getByRole('button', { name: 'deleteShot' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  view.rerender(<ShotCard {...props} shot={{ ...shot, id: 'second', prompt: 'Second shot' }} />);
  expect(screen.getByRole('region', { name: 'shotPreview' }).scrollTop).toBe(0);
  expect(screen.getByRole('complementary').scrollTop).toBe(0);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  view.rerender(<ShotCard {...props} shot={shot} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(props.onDelete).not.toHaveBeenCalled();
});

it('shows named references, removes every occurrence, and can undo without losing prose', () => {
  const original = '陆青[character1:陆青（持物）]站在亭中。\n[character2:雨夜破亭] [character1:陆青（持物）]';
  const open = vi.fn();
  function Editor() {
    const [prompt, setPrompt] = useState(original);
    return <ShotCard shot={{ id: 'second', prompt, tabMode: 'direct_r2v' }} index={0} totalShots={1}
      characters={[{ id: 'lu', name: '陆青', holding_reference: { selected_image_id: 'held', image_variants: [{ id: 'held', url: '/held.png' }] } }]}
      scenes={[{ name: '雨夜破亭', image_asset: { selected_id: 'scene', variants: [{ id: 'scene', url: '/scene.png' }] } }]} props={[]}
      onUpdatePrompt={setPrompt} onUpdateField={vi.fn()} onGenerateT2I={vi.fn()} onGenerateVideo={vi.fn()} onDelete={vi.fn()}
      onMoveUp={vi.fn()} onMoveDown={vi.fn()} onDuplicate={vi.fn()} onSetTabMode={vi.fn()} onOpenDrawer={open} onInsertAsset={vi.fn()} />;
  }
  render(<Editor />);
  const references = screen.getByRole('region', { name: 'shotReferences' });
  expect(within(references).getByRole('img', { name: '陆青（持物）' })).toHaveAttribute('src', '/held.png');
  fireEvent.click(within(references).getByRole('button', { name: 'removeReference 陆青（持物）' }));
  expect(screen.getByRole('textbox', { name: 'promptLabel' })).toHaveValue('陆青站在亭中。\n[character1:雨夜破亭] ');
  expect(within(references).queryByRole('img', { name: '陆青（持物）' })).not.toBeInTheDocument();
  expect(within(references).getByRole('img', { name: '雨夜破亭' })).toHaveAttribute('src', '/scene.png');
  fireEvent.click(screen.getByRole('button', { name: 'undoReferenceRemoval' }));
  expect(screen.getByRole('textbox', { name: 'promptLabel' })).toHaveValue(original);
  fireEvent.click(screen.getByRole('button', { name: 'addReference' }));
  expect(open).toHaveBeenCalledOnce();
  fireEvent.click(within(references).getByRole('button', { name: 'removeReference 陆青（持物）' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'promptLabel' }), { target: { value: 'A newer edit' } });
  expect(screen.queryByRole('button', { name: 'undoReferenceRemoval' })).not.toBeInTheDocument();
});
