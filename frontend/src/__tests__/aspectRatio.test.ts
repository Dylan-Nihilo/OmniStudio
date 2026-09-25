import { describe, expect, it } from 'vitest';
import {
  detectPromptAspectRatioConflict,
  exportResolutionsForAspectRatio,
  getAspectRatioCssValue,
} from '../lib/aspectRatio';

describe('aspect ratio helpers', () => {
  it('returns export resolutions for the configured master ratio', () => {
    expect(exportResolutionsForAspectRatio('9:16')[0]).toBe('1080x1920');
    expect(exportResolutionsForAspectRatio('16:9')[0]).toBe('1920x1080');
    expect(exportResolutionsForAspectRatio('1:1')[0]).toBe('1080x1080');
  });

  it('converts ratios to CSS aspect-ratio values', () => {
    expect(getAspectRatioCssValue('9:16')).toBe('9 / 16');
    expect(getAspectRatioCssValue('unknown')).toBe('16 / 9');
  });

  it('detects an explicit conflicting prompt ratio without flagging durations', () => {
    expect(detectPromptAspectRatioConflict('vertical 16:9 composition', '9:16')).toEqual({
      detected: ['16:9'],
      conflict: true,
    });
    expect(detectPromptAspectRatioConflict('a 16 second shot', '9:16')).toEqual({
      detected: [],
      conflict: false,
    });
  });

  it('detects full-width punctuation commonly pasted into Chinese prompts', () => {
    expect(detectPromptAspectRatioConflict('竖屏 16：9 构图', '9:16')).toEqual({
      detected: ['16:9'],
      conflict: true,
    });
  });
});
