import { describe, expect, it } from 'vitest';

import { shouldShowLocalCacheHint } from './useOfflineCache';

describe('useOfflineCache hint visibility', () => {
  it('does not show the same cache hint again after it was dismissed', () => {
    const cacheTimestamp = 1_000;
    expect(shouldShowLocalCacheHint(cacheTimestamp, 2_000, 2_000)).toBe(false);
    expect(shouldShowLocalCacheHint(cacheTimestamp, 2_000, 999)).toBe(true);
  });
});
