import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const themedFiles = [
  'ScriptEditorShell.tsx',
  'StandaloneScriptEditor.tsx',
  'toolbar/FormatToolbar.tsx',
  'panels/index.tsx',
  'panels/CharacterPanel.tsx',
  'panels/LocationPanel.tsx',
  'panels/PropsPanel.tsx',
  'panels/ShotPanel.tsx',
  'panels/PipelinePanel.tsx',
  'panels/NotesPanel.tsx',
  'sidebar/index.tsx',
  'sidebar/SceneNavigator.tsx',
  'sidebar/SearchPanel.tsx',
  'sidebar/OutlineView.tsx',
  'dialogs/ImportDialog.tsx',
  'dialogs/ExportDialog.tsx',
  'dialogs/PipelineLinkDialog.tsx',
  'dialogs/SnapshotListDialog.tsx',
];

describe('Script editor theme surfaces', () => {
  it('does not introduce fixed dark page surfaces', () => {
    const source = themedFiles
      .map((file) => readFileSync(resolve(process.cwd(), 'src/components/modules/ScriptEditor', file), 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/bg-zinc-(800|900|950)/);
    expect(source).not.toContain('bg-[#0a0a0f]');
    expect(source).not.toContain('bg-[#0c0c12]');
    expect(source).not.toContain('prose-invert');
    expect(source).not.toContain('bg-black/60');
    expect(source).not.toContain('bg-blue-900/30');
    expect(source).toContain('bg-primary/10');
    expect(source).toContain('border-primary/25');
  });

  it('removes the browser focus outline from the ProseMirror surface', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(styles).toMatch(/\.script-editor \.ProseMirror\s*\{[\s\S]*outline:\s*none;/);
  });
});
