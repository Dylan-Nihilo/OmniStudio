import { expect, it } from 'vitest';
import { buildAssembledPrompt } from '@/components/modules/storyboard-r2v/buildAssembledPrompt';

it('keeps a complete prompt authoritative when older camera settings remain saved', () => {
  const shot = { id: 'shot', tabMode: 'direct_r2v' as const, prompt: '固定机位，全景。[character1:苏]',
    shotSize: '特写', cameraMovementStructured: { primary: '缓慢推进', speed: 'slow' } };
  expect(buildAssembledPrompt({ ...shot, promptMode: 'complete' })).toBe('固定机位，全景。');
  expect(buildAssembledPrompt({ ...shot, promptMode: 'structured' })).toContain('缓慢推进');
});
