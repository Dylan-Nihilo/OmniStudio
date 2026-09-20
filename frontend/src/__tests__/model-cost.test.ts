/**
 * The image price book is keyed by pixel tier, so the client has to bucket a size exactly
 * the way the server does. A quote sent without a tier falls through to the catch-all row,
 * which is deliberately the dearest one — drift here silently overstates every image on
 * screen, and nothing else would fail.
 *
 * The expectations below are not hand-written: they are the output of
 * `src.billing.metering.size_tier` on the same inputs, captured on 2026-09-19. Regenerate
 * with:
 *   python -c "from src.billing.metering import size_tier; print([(c, size_tier(c)) for c in CASES])"
 */
import { describe, expect, it } from 'vitest';

import { estimateTextCredits, imageCostParams, sizeTier, TEXT_OUTPUT_RATIO } from '@/lib/modelCost';
import type { PricingTable } from '@/lib/billing';

const SERVER_RESULTS: [string | null | undefined, string | undefined][] = [
    ['1024x1024', '1K'],
    ['1024*1024', '1K'],
    ['1536x1024', '2K'],
    ['2048x2048', '2K'],
    ['3840x2160', '4K'],
    ['512x512', '1K'],
    ['1K', '1K'],
    ['2k', '2K'],
    ['4K', '4K'],
    ['2160x3840', '4K'],
    ['1025x100', '2K'],
    ['2049x2', '4K'],
    ['auto', undefined],
    ['', undefined],
    [null, undefined],
    ['1280*1280', '2K'],
];

describe('sizeTier agrees with the server', () => {
    it.each(SERVER_RESULTS)('buckets %s as %s', (input, expected) => {
        expect(sizeTier(input)).toBe(expected);
    });

    it('omits the tier rather than guessing when the size is unreadable', () => {
        // Dropping the key lets the catch-all row answer, which is what the server does too.
        expect(imageCostParams('auto')).toEqual({});
        expect(imageCostParams('1024x1024', 'high')).toEqual({ size_tier: '1K', quality: 'high' });
    });
});

const PRICING: PricingTable = {
    version: 1,
    credit_face_value_cny: 0.1,
    items: [
        { item_id: 'a', model_id: 'text/gpt-5.6-sol', stage: 'text', unit: 'chars_1k',
          match: { direction: 'in' }, credits: 2, credits_raw: 2, display_name: '高级' },
        { item_id: 'b', model_id: 'text/gpt-5.6-sol', stage: 'text', unit: 'chars_1k',
          match: { direction: 'out' }, credits: 4, credits_raw: 4, display_name: '高级' },
    ],
};

describe('estimating what a text action costs', () => {
    it('charges the input exactly and the reply by proportion', () => {
        // 20k characters in: 20 x 2 credits, plus an assumed reply of 35% at 4 credits.
        const expected = Math.ceil(20 * 2 + 20 * TEXT_OUTPUT_RATIO * 4);
        expect(estimateTextCredits(PRICING, 'gpt-5.6-sol', 20_000)).toBe(expected);
    });

    it('never estimates below the one-credit floor the server charges', () => {
        expect(estimateTextCredits(PRICING, 'gpt-5.6-sol', 5)).toBe(1);
    });

    it('says nothing rather than zero when there is no price book or no text', () => {
        expect(estimateTextCredits(null, 'gpt-5.6-sol', 20_000)).toBeNull();
        expect(estimateTextCredits(PRICING, 'gpt-5.6-sol', 0)).toBeNull();
        expect(estimateTextCredits(PRICING, 'some-unpriced-model', 20_000)).toBeNull();
    });
});
