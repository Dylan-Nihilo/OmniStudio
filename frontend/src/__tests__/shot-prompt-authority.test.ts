import { expect, it } from 'vitest';
import { buildAssembledPrompt } from '@/components/modules/storyboard-r2v/buildAssembledPrompt';

it('keeps a complete prompt authoritative when older camera settings remain saved', () => {
  const shot = { id: 'shot', tabMode: 'direct_r2v' as const, prompt: '固定机位，全景。[character1:苏]',
    shotSize: '特写', cameraMovementStructured: { primary: '缓慢推进', speed: 'slow' } };
  expect(buildAssembledPrompt({ ...shot, promptMode: 'complete' })).toBe('固定机位，全景。苏');
  expect(buildAssembledPrompt({ ...shot, promptMode: 'structured' })).toContain('缓慢推进');
});

it('keeps names from inline references without duplicating names already in the text', () => {
  const shot = { id: 'shot', tabMode: 'direct_r2v' as const, promptMode: 'complete' as const,
    prompt: '[character1:陆青]站在雨夜破亭[character2:雨夜破亭]，握住[character3:陆青的佩剑]。' };
  expect(buildAssembledPrompt(shot)).toBe('陆青站在雨夜破亭，握住陆青的佩剑。');
});
