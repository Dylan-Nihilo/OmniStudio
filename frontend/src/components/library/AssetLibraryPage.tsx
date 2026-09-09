"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { Search, Star, ArrowDownUp, Plus, LayoutGrid, Users, Mountain, Box, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { Character, Scene, Prop, ImageAsset } from "@/store/projectStore";
import { toast } from "@/store/toastStore";
import { characterImageUrl, characterVariants } from "@/lib/characterImage";
import { Button, IconButton, ActionMenu, SelectField, TextField, LoadingState, EmptyState } from "@omnistudio/ui";
import AppShell from "@/components/layout/AppShell";
import styles from "./AssetLibraryPage.module.css";
import navigationStyles from "@/components/layout/GlobalSidebar.module.css";
import { getAssetUrl } from "@/lib/utils";
import AssetInspector from "./AssetInspector";
import NewLibraryAssetDialog from "./NewLibraryAssetDialog";

type AssetTab = "characters" | "scenes" | "props";
type TypeFilter = AssetTab | "all";
type SortMode = "default" | "name" | "recent";
type ViewAxis = "gallery" | "type" | "source";

const SINGULAR: Record<AssetTab, string> = { characters: "character", scenes: "scene", props: "prop" };

interface AssetSource {
  id: string; // `series-X` / `project-X`（列表 key）
  rawId: string; // 裸 series/project id（调 API 用）
  name: string;
  kind: "series" | "project" | "global";
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
}

/** 渲染条目：携带所属 source，使「按类型」视图也能按源显示/操作。 */
type UnknownRecord = Record<string, any>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeVariants(value: unknown, prefix: string): ImageAsset["variants"] {
  return asArray(value).map((item, index) => {
    const raw = asRecord(item);
    return {
      id: asString(raw.id, prefix + "-variant-" + index),
      url: asString(raw.url),
      created_at: typeof raw.created_at === "number" && Number.isFinite(raw.created_at) ? raw.created_at : 0,
      ...(typeof raw.prompt_used === "string" ? { prompt_used: raw.prompt_used } : {}),
    };
  });
}

function normalizeImageAsset(value: unknown, prefix: string): ImageAsset | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = asRecord(value);
  const variants = normalizeVariants(raw.variants, prefix);
  const selectedId = typeof raw.selected_id === "string" || raw.selected_id === null ? raw.selected_id : null;
  return { selected_id: selectedId, variants };
}

function normalizeAsset(value: unknown, type: AssetTab, index: number): Character | Scene | Prop {
  const raw = asRecord(value);
  const id = asString(raw.id, type + "-" + index);
  const name = asString(raw.name, "Untitled " + type.slice(0, -1));
  const description = asString(raw.description);
  const imageAsset = normalizeImageAsset(raw.image_asset, id + "-image");
  const base: UnknownRecord = { ...raw, id, name, description, ...(imageAsset ? { image_asset: imageAsset } : {}) };
  if (type === "characters") {
    const reference = asRecord(raw.reference_sheet);
    const referenceVariants = normalizeVariants(reference.image_variants, id + "-reference");
    const fullBody = normalizeImageAsset(raw.full_body_asset, id + "-full-body");
    return {
      ...base,
      ...(referenceVariants.length > 0 || raw.reference_sheet ? {
        reference_sheet: {
          selected_image_id: typeof reference.selected_image_id === "string" || reference.selected_image_id === null ? reference.selected_image_id : null,
          image_variants: referenceVariants,
        },
      } : {}),
      ...(fullBody ? { full_body_asset: fullBody } : {}),
    } as Character;
  }
  return base as Scene | Prop;
}

function normalizeSource(value: unknown, kind: AssetSource["kind"], index: number, fallbackName: string): AssetSource {
  const raw = asRecord(value);
  const rawId = asString(raw.id, kind + "-" + index);
  return {
    id: kind + "-" + rawId,
    rawId,
    name: asString(raw.title ?? raw.name, fallbackName),
    kind,
    characters: asArray(raw.characters).map((item, i) => normalizeAsset(item, "characters", i) as Character),
    scenes: asArray(raw.scenes).map((item, i) => normalizeAsset(item, "scenes", i) as Scene),
    props: asArray(raw.props).map((item, i) => normalizeAsset(item, "props", i) as Prop),
  };
}

function sourceHasAssets(source: AssetSource): boolean {
  return source.characters.length + source.scenes.length + source.props.length > 0;
}

interface RenderItem {
  asset: Character | Scene | Prop;
  type: AssetTab;
  src: AssetSource;
}

/** 渲染分组：「按类型」按资产类型、「按项目」按源，统一结构（title + meta + items）。 */
interface RenderGroup {
  key: string;
  title: string;
  meta: string;
  items: RenderItem[];
}

/** 取图：character 走 characterImageUrl（reference_sheet→full_body→legacy）；scene/prop 用 image_asset。 */
function getImageUrl(asset: Character | Scene | Prop, type: AssetTab): string | undefined {
  if (type === "characters") return characterImageUrl(asset as Character);
  const a = asset as Scene | Prop;
  if (a.image_asset?.variants?.length) {
    const sel = a.image_asset.variants.find((v) => v.id === a.image_asset?.selected_id);
    return sel?.url || a.image_asset.variants[0]?.url;
  }
  return a.image_url;
}

function variantCount(asset: Character | Scene | Prop, type: AssetTab): number {
  if (type === "characters") return characterVariants(asset as Character).length;
  const variants = (asset as Scene | Prop).image_asset?.variants;
  return Array.isArray(variants) ? variants.length : 0;
}

/** 「最近」排序用：派生资产的最新图片时间戳（秒，time.time）。
 *  character 取 full_body/three_view/headshot updated_at + reference_sheet 变体 created_at 的最大值；
 *  scene/prop 取 image_asset 的 created_at/image_updated_at + 变体 created_at 的最大值。
 *  全无时间戳 → 0（降序时排最后）。纯前端派生。 */
function recencyOf(asset: Character | Scene | Prop, type: AssetTab): number {
  const ts: number[] = [];
  if (type === "characters") {
    const c = asset as Character;
    if (c.full_body_updated_at) ts.push(c.full_body_updated_at);
    if (c.three_view_updated_at) ts.push(c.three_view_updated_at);
    if (c.headshot_updated_at) ts.push(c.headshot_updated_at);
    for (const v of c.reference_sheet?.image_variants ?? []) if (v.created_at) ts.push(v.created_at);
  } else {
    const a = asset as Scene | Prop;
    // ImageAsset 的 TS 类型未声明 created_at/image_updated_at，但后端确实下发（time.time 秒）；
    // 防御性读取后端字段，并以变体 created_at 兜底。
    const ia = a.image_asset as (ImageAsset & { created_at?: number; image_updated_at?: number }) | undefined;
    if (ia?.created_at) ts.push(ia.created_at);
    if (ia?.image_updated_at) ts.push(ia.image_updated_at);
    for (const v of ia?.variants ?? []) if (v.created_at) ts.push(v.created_at);
  }
  return ts.length ? Math.max(...ts) : 0;
}

export default function AssetLibraryPage() {
  const t = useTranslations("library");
  const tc = useTranslations("common");
  const [sources, setSources] = useState<AssetSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeType, setActiveType] = useState<TypeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [viewAxis, setViewAxis] = useState<ViewAxis>("gallery");
  const [starredOnly, setStarredOnly] = useState(false);
  const [selected, setSelected] = useState<{ sourceId: string; assetId: string; type: AssetTab } | null>(null);
  const [newAssetOpen, setNewAssetOpen] = useState(false);

  const selectedTrigger = useRef<HTMLButtonElement | null>(null);
  const closeInspector = () => {
    setSelected(null);
    requestAnimationFrame(() => selectedTrigger.current?.isConnected && selectedTrigger.current.focus());
  };
  const [sourceFilter, setSourceFilter] = useState("all");
  const [loadFailed, setLoadFailed] = useState(false);
  const [starPending, setStarPending] = useState<Set<string>>(new Set());
  const starRequests = useRef(new Set<string>());
  const loadRequest = useRef(0);
  useEffect(() => {
    void loadAssets();
    return () => { loadRequest.current += 1; };
  }, []);

  const loadAssets = async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const [seriesList, projects, globalPool] = await Promise.all([
        api.listSeries(),
        api.getProjects(),
        api.listLibraryAssets(),
      ]);
      const result: AssetSource[] = [];
      const seriesItems = asArray(seriesList);
      const projectItems = asArray(projects);

      for (let index = 0; index < seriesItems.length; index += 1) {
        const source = normalizeSource(seriesItems[index], "series", index, t("series"));
        if (sourceHasAssets(source)) result.push(source);
      }

      for (let index = 0; index < projectItems.length; index += 1) {
        const rawProject = asRecord(projectItems[index]);
        if (rawProject.series_id) continue;
        const source = normalizeSource(rawProject, "project", index, t("project"));
        if (sourceHasAssets(source)) result.push(source);
      }

      // 全局/共享池返回异常时按空池处理，避免进入页面渲染阶段崩溃。
      const globalRaw = asRecord(globalPool);
      const globalSource: AssetSource = {
        id: "global",
        rawId: "global",
        name: t("globalGroup"),
        kind: "global",
        characters: asArray(globalRaw.characters).map((item, index) => normalizeAsset(item, "characters", index) as Character),
        scenes: asArray(globalRaw.scenes).map((item, index) => normalizeAsset(item, "scenes", index) as Scene),
        props: asArray(globalRaw.props).map((item, index) => normalizeAsset(item, "props", index) as Prop),
      };
      if (sourceHasAssets(globalSource)) result.push(globalSource);

      if (request === loadRequest.current) setSources(result);
    } catch (error) {
      if (request !== loadRequest.current) return;
      setLoadFailed(true);
      console.error("Failed to load asset library:", error);
      toast.error(t("loadFailed"), { body: t("loadFailedBody") });
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  };

  // 全局计数（facet 总览；不受搜索/星标过滤影响，与分组标题里的计数互补）。
  const counts = useMemo(() => {
    let ch = 0,
      sc = 0,
      pr = 0,
      st = 0;
    for (const s of sources) {
      ch += s.characters.length;
      sc += s.scenes.length;
      pr += s.props.length;
      st +=
        s.characters.filter((a) => a.starred).length +
        s.scenes.filter((a) => a.starred).length +
        s.props.filter((a) => a.starred).length;
    }
    return { characters: ch, scenes: sc, props: pr, all: ch + sc + pr, starred: st };
  }, [sources]);

  const typePills: { id: TypeFilter; label: string; count: number }[] = [
    { id: "all", label: t("allLabel"), count: counts.all },
    { id: "characters", label: t("characterLabel"), count: counts.characters },
    { id: "scenes", label: t("sceneLabel"), count: counts.scenes },
    { id: "props", label: t("propLabel"), count: counts.props },
  ];

  const TYPE_LABEL: Record<AssetTab, string> = {
    characters: t("characterLabel"),
    scenes: t("sceneLabel"),
    props: t("propLabel"),
  };

  // Only expose sorting backed by available asset data.
  const sortOptions: { id: SortMode; label: string; disabled?: boolean }[] = [
    { id: "default", label: t("sortDefault") },
    { id: "name", label: t("sortName") },
    { id: "recent", label: t("sortRecent") },
  ];
  // 渲染模型：两种轴。
  //  - "type"（默认）：按资产类型分 3 组（角色/场景/道具），每组含所有 source 的该类型资产，
  //    卡片副标题显示所属 source 名。
  //  - "source"：按 source 分组（系列/项目/全局），保持原行为。
  // 两者都受 activeType pill + 搜索 + 星标过滤，并按 sortMode 排序。
  const groups = useMemo<RenderGroup[]>(() => {
    const scopedTypes: AssetTab[] = activeType === "all" ? ["characters", "scenes", "props"] : [activeType];
    const q = searchQuery.trim().toLowerCase();
    const match = (a: Character | Scene | Prop) =>
      (!starredOnly || !!a.starred) &&
      (!q || a.name.toLowerCase().includes(q) || (a.description ?? "").toLowerCase().includes(q));
    const sortItems = (items: RenderItem[]) => {
      if (sortMode === "name") items.sort((x, y) => x.asset.name.localeCompare(y.asset.name, "zh"));
      else if (sortMode === "recent") items.sort((x, y) => recencyOf(y.asset, y.type) - recencyOf(x.asset, x.type));
      // Default preserves insertion order.
      return items;
    };
    const typeLabel = (ty: AssetTab) =>
      ty === "characters" ? t("characterLabel") : ty === "scenes" ? t("sceneLabel") : t("propLabel");

    const filteredSources = sources.filter(source => sourceFilter === "all" || source.id === sourceFilter);
    if (viewAxis === "gallery") {
      const items = filteredSources.flatMap(src => scopedTypes.flatMap(type => src[type].filter(match).map(asset => ({ asset, type, src }))));
      return items.length ? [{ key: "gallery", title: t("gallery"), meta: String(items.length), items: sortItems(items) }] : [];
    }
    if (viewAxis === "type") {
      return scopedTypes
        .map((ty): RenderGroup => {
          const items: RenderItem[] = [];
          for (const src of filteredSources)
            for (const a of src[ty] as (Character | Scene | Prop)[]) if (match(a)) items.push({ asset: a, type: ty, src });
          sortItems(items);
          return { key: `type-${ty}`, title: typeLabel(ty), meta: String(items.length), items };
        })
        .filter((grp) => grp.items.length > 0);
    }

    const kindLabel = (k: AssetSource["kind"]) =>
      k === "series" ? t("series") : k === "global" ? t("globalGroup") : t("project");
    return filteredSources
      .map((src): RenderGroup => {
        const items: RenderItem[] = [];
        for (const ty of scopedTypes)
          for (const a of src[ty] as (Character | Scene | Prop)[]) if (match(a)) items.push({ asset: a, type: ty, src });
        sortItems(items);
        return { key: src.id, title: src.name, meta: `${kindLabel(src.kind)} · ${items.length}`, items };
      })
      .filter((grp) => grp.items.length > 0);
  }, [sources, activeType, searchQuery, starredOnly, sortMode, viewAxis, sourceFilter, t]);

  const visibleCount = groups.reduce((acc, g) => acc + g.items.length, 0);

  // 选中的资产被筛掉后自动关 inspector（避免残留指向已隐藏资产）。
  useEffect(() => {
    if (!selected) return;
    const stillVisible = groups.some((grp) =>
      grp.items.some(
        (it) => it.src.id === selected.sourceId && it.asset.id === selected.assetId && it.type === selected.type
      )
    );
    if (!stillVisible) setSelected(null);
  }, [groups, selected]);

  const toggleStar = async (sourceId: string, assetId: string, type: AssetTab) => {
    const requestKey = `${sourceId}/${type}/${assetId}`;
    if (starRequests.current.has(requestKey)) return;
    const src = sources.find((s) => s.id === sourceId);
    if (!src) return;
    const cur = (src[type] as (Character | Scene | Prop)[]).find((a) => a.id === assetId);
    if (!cur) return;
    starRequests.current.add(requestKey);
    setStarPending(new Set(starRequests.current));
    const prevStarred = !!cur.starred;
    const setStarredTo = (val: boolean) => (prev: AssetSource[]) =>
      prev.map((s) =>
        s.id !== sourceId
          ? s
          : { ...s, [type]: (s[type] as (Character | Scene | Prop)[]).map((a) => (a.id === assetId ? { ...a, starred: val } : a)) }
      );
    setSources(setStarredTo(!prevStarred)); // 乐观更新
    try {
      if (src.kind === "series") await api.toggleSeriesAssetStarred(src.rawId, assetId, SINGULAR[type]);
      else if (src.kind === "global") await api.updateLibraryAsset(SINGULAR[type], assetId, { starred: !prevStarred });
      else await api.toggleAssetStarred(src.rawId, assetId, SINGULAR[type]);
    } catch (e) {
      console.error("toggle star failed", e);
      setSources(setStarredTo(prevStarred));
      toast.error(t("starFailed"));
    } finally {
      starRequests.current.delete(requestKey);
      setStarPending(new Set(starRequests.current));
    }
  };

  // 选中资产的实时引用（以 sources 为单一数据源，保证星标等变更同步到 inspector）。
  const selectedSource = selected ? sources.find((s) => s.id === selected.sourceId) : undefined;
  const selectedAsset =
    selected && selectedSource
      ? (selectedSource[selected.type] as (Character | Scene | Prop)[]).find((a) => a.id === selected.assetId)
      : undefined;

  const navigation = <nav className={styles.navigation} aria-label={t("title")}>
    <div className={navigationStyles.subnavItems}>{typePills.map((pill, index) => {
      const Icon = [LayoutGrid, Users, Mountain, Box][index];
      return <Button key={pill.id} variant="quiet" aria-pressed={activeType === pill.id} onPress={() => setActiveType(pill.id)}><Icon size={16} />{pill.label}<span className={navigationStyles.subnavCount}>{pill.count}</span></Button>;
    })}</div>
  </nav>;
  const clearFilters = () => { setActiveType("all"); setSearchQuery(""); setStarredOnly(false); setSourceFilter("all"); };
  return <AppShell activeTab="library" onTabChange={() => {}} context={navigation}>
    <div className={styles.page}>
      <header className={styles.header}>
        <div><p>{t("title")} / {t("assetCount", { count: visibleCount })}</p><h1>{t("headline")}</h1></div>
        <div className={styles.headerActions}>
          <IconButton aria-label={t("refresh")} onPress={() => void loadAssets()} isDisabled={loading}><RefreshCw size={18} /></IconButton>
          <Button onPress={() => setNewAssetOpen(true)}><Plus size={16} />{t("newAsset")}</Button>
        </div>
      </header>
      <div className={styles.body} data-inspecting={Boolean(selectedAsset)}>
        <div className={styles.gallery}>
          <div className={styles.toolbar}>
            <TextField type="search" aria-label={t("searchPlaceholder")} label={t("searchPlaceholder")} value={searchQuery} onChange={setSearchQuery} placeholder={t("searchPlaceholder")} className={styles.search} />
            <Button variant="quiet" aria-pressed={starredOnly} aria-label={t("starredOnlyAria")} onPress={() => setStarredOnly(value => !value)}><Star size={16} className={starredOnly ? "fill-current" : ""} />{counts.starred}</Button>
            <SelectField label={t("metaSource")} value={sourceFilter} onChange={key => setSourceFilter(String(key))} options={[{ id: "all", label: t("allSources") }, ...sources.map(source => ({ id: source.id, label: source.name }))]} className={styles.source} />
            <ActionMenu label={t("sortLabel")} icon={<ArrowDownUp size={16} />} items={sortOptions.map(option => ({ id: option.id, label: option.label, onAction: () => setSortMode(option.id) }))} />
            <SelectField label={t("viewLabel")} value={viewAxis} onChange={key => setViewAxis(String(key) as ViewAxis)} options={[{ id: "gallery", label: t("gallery") }, { id: "type", label: t("viewByType") }, { id: "source", label: t("viewByProject") }]} className={styles.view} />
          </div>
          {loadFailed && <div role="alert" className={styles.error}><span>{t("loadFailed")}</span><Button variant="quiet" onPress={() => void loadAssets()}>{t("retry")}</Button></div>}
          {loading && <LoadingState label={tc("loading")} inline={sources.length > 0} />}
          {!loading && !loadFailed && counts.all === 0 ? <EmptyState title={t("noAssets")} description={t("noAssetsHint")} action={<Button onPress={() => setNewAssetOpen(true)}>{t("newAsset")}</Button>} />
            : !loading && sources.length > 0 && groups.length === 0 ? <EmptyState title={t("noMatchTitle")} description={tc("noMatchHint")} media={<Search size={32} />} action={<Button variant="secondary" onPress={clearFilters}>{tc("clearFilters")}</Button>} />
            : groups.map(group => <section key={group.key} className={styles.group}>
              <header><h2>{group.title}</h2><span>{group.meta}</span></header>
              <div className={styles.grid}>{group.items.map(({ asset, type, src }) => {
                const url = getAssetUrl(getImageUrl(asset, type));
                const count = variantCount(asset, type);
                const isSelected = selected?.sourceId === src.id && selected?.assetId === asset.id && selected?.type === type;
                return <article key={`${src.id}/${type}/${asset.id}`} className={styles.card} data-selected={isSelected}>
                  <button type="button" className={styles.openCard} onClick={event => { selectedTrigger.current = event.currentTarget; setSelected({ sourceId: src.id, assetId: asset.id, type }); }} aria-label={asset.name} aria-pressed={isSelected}>
                    {url ? <img src={url} alt={asset.name} loading="lazy" /> : <div className={styles.noImage} aria-hidden="true"><Box size={28} /></div>}
                    <strong>{asset.name}</strong><span>{TYPE_LABEL[type]} · {src.name}{count > 0 ? ` · ${t("variantCount", { count })}` : ""}</span>
                  </button>
                  <IconButton className={styles.star} aria-label={asset.starred ? t("unstar") : t("star")} aria-pressed={!!asset.starred} isDisabled={starPending.has(`${src.id}/${type}/${asset.id}`)} onPress={() => void toggleStar(src.id, asset.id, type)}><Star size={15} className={asset.starred ? "fill-current" : ""} /></IconButton>
                </article>;
              })}</div>
            </section>)}
        </div>
        {selected && selectedAsset && selectedSource && <AssetInspector key={`${selected.sourceId}/${selected.type}/${selected.assetId}`} asset={selectedAsset} type={selected.type} sourceName={selectedSource.name} sourceId={selected.sourceId} sourceKind={selectedSource.kind} starred={!!selectedAsset.starred} starPending={starPending.has(`${selected.sourceId}/${selected.type}/${selected.assetId}`)} onClose={closeInspector} onToggleStar={() => void toggleStar(selected.sourceId, selected.assetId, selected.type)} onPromoted={loadAssets} onAssetDeleted={loadAssets} onAssetUpdated={updated => setSources(previous => previous.map(source => source.id === selected.sourceId ? { ...source, [selected.type]: source[selected.type].map(asset => asset.id === updated.id ? normalizeAsset(updated, selected.type, 0) : asset) } : source))} />}
      </div>
      {newAssetOpen && <NewLibraryAssetDialog onClose={() => setNewAssetOpen(false)} onCreated={loadAssets} />}
    </div>
  </AppShell>;
}
