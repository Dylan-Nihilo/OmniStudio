import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { EditorContent, type Editor } from '@tiptap/react';
import { expect, it } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import { useEditorSetup } from '../hooks/useEditorSetup';
import ShotPanel from './ShotPanel';

it('adds editable shots with the real screenplay schema and updates the panel through undo and reload', async () => {
  let editor: Editor | null = null;
  function Harness() {
    const setup = useEditorSetup({ content: {
      type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: '顾潮生打开纸箱。' }] }],
    } });
    editor = setup.editor;
    return <><EditorContent editor={editor} /><ShotPanel editor={editor} /></>;
  }
  renderWithIntl(<Harness />);
  await waitFor(() => expect(editor).not.toBeNull());
  act(() => { editor!.commands.setTextSelection(editor!.state.doc.content.size - 1); });
  fireEvent.click(screen.getByRole('button', { name: '添加镜头' }));

  const shots = () => editor!.getJSON().content!.filter(node => node.type === 'shotBlock');
  expect(shots()).toHaveLength(1);
  expect(() => editor!.state.doc.check()).not.toThrow();
  expect(shots()[0].attrs?.id).toEqual(expect.any(String));
  expect(shots()[0].attrs?.pipelineStatus).toBe('suggested');
  await waitFor(() => expect(screen.getByRole('button', { name: '#1' })).toBeVisible());
  act(() => { editor!.commands.insertContent('蓝色信标亮起。'); });
  expect(shots()[0].content).toEqual([{ type: 'text', text: '蓝色信标亮起。' }]);
  fireEvent.click(screen.getByRole('button', { name: '添加镜头' }));
  expect(shots()).toHaveLength(2);
  expect(new Set(shots().map(node => node.attrs?.id)).size).toBe(2);
  await waitFor(() => expect(screen.getByRole('button', { name: '#2' })).toBeVisible());
  const saved = editor!.getJSON();
  act(() => { editor!.commands.undo(); });
  await waitFor(() => expect(screen.queryByRole('button', { name: '#2' })).not.toBeInTheDocument());
  act(() => { editor!.commands.setContent(saved); });
  await waitFor(() => expect(screen.getByRole('button', { name: '#2' })).toBeVisible());
  expect(editor!.getText()).toContain('顾潮生打开纸箱。');
  expect(editor!.getText()).toContain('蓝色信标亮起。');
  expect(() => editor!.state.doc.check()).not.toThrow();
});
