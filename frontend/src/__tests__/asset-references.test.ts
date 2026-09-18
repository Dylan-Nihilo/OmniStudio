import { expect, it } from 'vitest';
import { selectedAssetReference, resolveStoryboardReferenceTags, nextReferenceTag, holdingReferenceName, removeStoryboardReference } from '@/lib/assetReferences';
import type { Character, ImageAsset } from '@/store/projectStore';

it('uses the chosen holding image in a shot while keeping the base reference separate', () => {
    const character = { id: 'hero', name: '陆青',
        reference_sheet: { selected_image_id: 'base', image_variants: [{ id: 'base', url: '/base.png', created_at: 0 }] },
        holding_reference: { selected_image_id: 'held', image_variants: [{ id: 'held', url: '/held.png', created_at: 1 }] },
    } satisfies Character;
    const prop = { id: 'sword', name: '剑', image_asset: { selected_id: 'sword-image', variants: [{ id: 'sword-image', url: '/sword.png', created_at: 0 }] } satisfies ImageAsset };
    const name = holdingReferenceName(character.name);
    const tag1 = nextReferenceTag('', name);
    const tag2 = nextReferenceTag(tag1, prop.name);
    expect(resolveStoryboardReferenceTags(`${tag1} ${tag2} ${tag1}`, [character], [], [prop])).toMatchObject({ urls: ['/held.png', '/sword.png'], missing: [] });
    expect(selectedAssetReference(character, 'character')?.variant_id).toBe('base');
    expect(nextReferenceTag(`${tag1} ${tag2}`, name)).toBe(tag1);
    character.holding_reference.selected_image_id = 'missing';
    expect(resolveStoryboardReferenceTags(tag1, [character], [], [prop]).missing).toEqual([name]);
});

it('requires a selected source image and reports conflicting reference slots', () => {
    const character: Character = { id: 'hero', name: '陆青', reference_sheet: { selected_image_id: null,
        image_variants: [{ id: 'candidate', url: '/candidate.png', created_at: 0 }] } };
    expect(selectedAssetReference(character, 'character')).toBeUndefined();
    expect(resolveStoryboardReferenceTags('[character1:陆青] [character1:沈砚]', [character], [], []).missing).toEqual(['沈砚']);
});

it('removes references from generation inputs and keeps remaining image slots aligned', () => {
    const scenes = ['错选', '破亭', '雨夜'].map((name, i) => ({ name, image_asset: { selected_id: name, variants: [{ id: name, url: `/${i}.png`, created_at: 0 }] } }));
    const original = '场景：[character3:雨夜] [character1:错选] [character2:破亭] [character1:错选]';
    const removed = removeStoryboardReference(original, '错选');
    expect(removed).toBe('场景：[character2:雨夜]  [character1:破亭] ');
    expect(resolveStoryboardReferenceTags(removed, [], scenes, []).urls).toEqual(['/1.png', '/2.png']);
    expect(nextReferenceTag(removed, '沈砚（持物）')).toBe('[character3:沈砚（持物）]');
    const empty = removeStoryboardReference(removeStoryboardReference(removed, '破亭'), '雨夜');
    expect(resolveStoryboardReferenceTags(empty, [], scenes, []).urls).toEqual([]);
    expect(empty).toBe('场景：   ');
});
