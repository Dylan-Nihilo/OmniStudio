export interface OmniMediaReference { url: string; purpose: string }
export interface OmniReferenceSettings {
    videos: OmniMediaReference[];
    audios: OmniMediaReference[];
    audio_mode: 'post' | 'native' | 'driven' | 'silent';
}
export const supportsOmniReferences = (model: string) =>
    model === 'seedance-2.5-r2v' || model === 'seedance/seedance-2.5-video#r2v';
export const omniReferenceLimits = () => getOmniReferenceLimits('seedance-2.5-r2v');

export function publicMediaUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password
            && url.hostname !== 'localhost' && !url.hostname.endsWith('.local');
    } catch { return false; }
}
import { getOmniReferenceLimits } from './modelCatalog';
