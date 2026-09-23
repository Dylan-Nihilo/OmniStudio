type Asset = { id: string; source?: string };
type Frame = { character_ids?: string[]; scene_id?: string; prop_ids?: string[] };

/** Shared assets remain available in the library/picker; episode views show use. */
export function episodeAssets<C extends Asset, S extends Asset, P extends Asset>(project: {
  characters?: C[]; scenes?: S[]; props?: P[]; frames?: Frame[];
} | null | undefined) {
  const frames = project?.frames ?? [];
  // Before storyboard extraction there are no frame references to identify
  // which shared assets belong to this episode. Keep episode-local and
  // current-series entities visible so freshly extracted assets remain usable,
  // but exclude the workspace-wide global library from this episode view.
  if (frames.length === 0) {
    return {
      characters: (project?.characters ?? []).filter(asset => asset.source !== 'global'),
      scenes: (project?.scenes ?? []).filter(asset => asset.source !== 'global'),
      props: (project?.props ?? []).filter(asset => asset.source !== 'global'),
    };
  }
  const characterIds = new Set(frames.flatMap(f => f.character_ids ?? []));
  const sceneIds = new Set(frames.map(f => f.scene_id));
  const propIds = new Set(frames.flatMap(f => f.prop_ids ?? []));
  const belongs = (asset: Asset, ids: Set<string | undefined>) =>
    !asset.source || asset.source === 'episode' || ids.has(asset.id);
  return {
    characters: (project?.characters ?? []).filter(a => belongs(a, characterIds)),
    scenes: (project?.scenes ?? []).filter(a => belongs(a, sceneIds)),
    props: (project?.props ?? []).filter(a => belongs(a, propIds)),
  };
}
