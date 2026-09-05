"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { useTranslations } from "next-intl";
import { X, Star, Download, Sparkles, Globe } from "lucide-react";
import type { Character, Scene, Prop, ImageAsset, ImageVariant } from "@/store/projectStore";
import { characterImageAsset } from "@/lib/characterImage";
import { api } from "@/lib/api";
import { toast } from "@/store/toastStore";
import { Button, IconButton } from "@omnistudio/ui";
import styles from "./AssetLibraryPage.module.css";
import { getAssetUrl } from "@/lib/utils";

type AssetTab = "characters" | "scenes" | "props";

// 资产类型 → 后端单数 type（生成端点用）。
const SINGULAR_TYPE: Record<AssetTab, string> = {
  characters: "character",
  scenes: "scene",
  props: "prop",
};

// 「生成更多变体」一次追加的张数 + 任务轮询参数（~5 分钟上限）。
const VARIANT_BATCH = 3;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 150;

interface AssetInspectorProps {
  asset: Character | Scene | Prop;
  type: AssetTab;
  sourceName: string;
  /** 裸 series/project id（调生成/刷新 API 用）。 */
  sourceId: string;
  /** 资产归属：series/global 无生成端点 → 变体生成置灰。 */
  sourceKind: "series" | "project" | "global";
  starred: boolean;
  starPending?: boolean;
  onClose: () => void;
  onToggleStar: () => void;
  /** 提升到全局成功后回调（父层刷新库以显示新入池资产）。可选。 */
  onPromoted?: () => void;
}

/** Character 走 characterImageAsset（reference_sheet→full_body，归一化成 ImageAsset 形状）；scene/prop 用 image_asset。 */
function primaryImageAsset(asset: Character | Scene | Prop, type: AssetTab): ImageAsset | undefined {
  if (type === "characters") return characterImageAsset(asset as Character);
  return (asset as Scene | Prop).image_asset;
}

function fallbackUrl(asset: Character | Scene | Prop, type: AssetTab): string | undefined {
  if (type === "characters") {
    const c = asset as Character;
    return c.image_url || c.full_body_image_url;
  }
  return (asset as Scene | Prop).image_url;
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

/** 下载文件名扩展名：优先取 URL 路径后缀（剥掉 query/签名），否则回退到 blob content-type，默认 png。 */
function downloadExt(url: string, contentType?: string): string {
  try {
    const path = new URL(url, window.location.origin).pathname;
    const m = path.match(/\.([a-z0-9]+)$/i);
    if (m) return m[1].toLowerCase();
  } catch {
    // URL 解析失败时退回 content-type / 默认
  }
  const fromType = contentType?.split(";")[0].trim().toLowerCase();
  if (fromType && MIME_EXT[fromType]) return MIME_EXT[fromType];
  return "png";
}

/**
 * 资产库右侧详情抽屉（Line B "Luminous Atelier"）。
 * 库专用，不复用共享 AssetCard。展示选中资产的 hero + 变体条 + 元数据 + prompt + 动作。
 * 元数据数据驱动（metaRows）：SEED/MODEL/SIZE 当前数据模型未存（变体仅
 * id/url/created_at/prompt_used），故读为 undefined → 不渲染；后端补字段后 UI 零改自动出现。
 * 动作区：「下载」实做；「生成更多变体」对 project 资产实做（series 置灰，无生成端点）。
 */
export default function AssetInspector({
  asset,
  type,
  sourceName,
  sourceId,
  sourceKind,
  starred,
  starPending = false,
  onClose,
  onToggleStar,
  onPromoted,
}: AssetInspectorProps) {
  const t = useTranslations("library");
  const TYPE_LABEL: Record<AssetTab, string> = {
    characters: t("characterLabel"),
    scenes: t("sceneLabel"),
    props: t("propLabel"),
  };
  // created_at 来自 time.time()（秒）；容错已是毫秒的情况。相对时间标签走 i18n。
  const timeAgo = (ts?: number): string => {
    if (!ts) return "—";
    const tsMs = ts > 1e12 ? ts : ts * 1000;
    const days = Math.floor((Date.now() - tsMs) / 86_400_000);
    if (days <= 0) return t("timeToday");
    if (days === 1) return t("timeYesterday");
    if (days < 30) return t("timeDaysAgo", { days });
    return t("timeMonthsAgo", { months: Math.floor(days / 30) });
  };
  const imageAsset = primaryImageAsset(asset, type);
  const baseVariants = imageAsset?.variants ?? [];
  // 本地新生成的变体（来自「生成更多变体」）。父层 library 自己持有 `sources` 且只在整页
  // reload 时刷新，所以新变体在此并入以即时反馈；按 id 与 prop 集去重，父层后续 reload
  // （届时新变体会随 `baseVariants` 带回）也不会重复。
  const [extraVariants, setExtraVariants] = useState<ImageVariant[]>([]);
  const baseIds = new Set(baseVariants.map((v) => v.id));
  const variants = [...baseVariants, ...extraVariants.filter((v) => !baseIds.has(v.id))];
  const defaultId = imageAsset?.selected_id ?? baseVariants[0]?.id ?? null;
  const [activeVariantId, setActiveVariantId] = useState<string | null>(defaultId);
  const [generating, setGenerating] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // 切换选中资产时重置本地高亮的变体 + 丢弃上一个资产本地追加的变体。
  useEffect(() => {
    setActiveVariantId(defaultId);
    setExtraVariants([]);
  }, [asset.id, defaultId]);

  // 卸载/切换资产后避免异步轮询回写已失效的状态。
  const aliveRef = useRef(true);
  const currentAssetIdRef = useRef(asset.id);
  useEffect(() => {
    currentAssetIdRef.current = asset.id;
  }, [asset.id]);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // a11y：抽屉打开时把焦点移入面板、Escape 关闭、关闭后还原焦点（非模态，不做 focus trap）。
  const asideRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    asideRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  const activeVariant = variants.find((v) => v.id === activeVariantId) ?? variants[0];
  const heroUrl = getAssetUrl(activeVariant?.url ?? fallbackUrl(asset, type)) || undefined;
  const prompt = activeVariant?.prompt_used ?? "";

  // 元数据行（数据驱动）：先放现有四项，再在字段存在时追加 SEED/MODEL/SIZE。
  // 后端 TODO：当前 ImageVariant 仅 id/url/created_at/prompt_used，资产无 seed/model/size，
  // 故 assetMeta.* 读为 undefined → 不 push → 不渲染。后端补字段后此处零改自动出现。
  const assetMeta = asset as Partial<{ seed: number | string; model: string; size: string }>;
  const metaRows: { label: string; value: string }[] = [
    { label: t("metaType"), value: TYPE_LABEL[type] },
    { label: t("metaSource"), value: sourceName },
    { label: t("metaVariant"), value: `${variants.length}` },
    { label: t("metaCreated"), value: timeAgo(activeVariant?.created_at) },
  ];
  if (assetMeta.seed != null) metaRows.push({ label: "SEED", value: String(assetMeta.seed) });
  if (assetMeta.model) metaRows.push({ label: "MODEL", value: assetMeta.model });
  if (assetMeta.size) metaRows.push({ label: "SIZE", value: assetMeta.size });

  const handleDownload = async () => {
    if (!heroUrl || downloading) return;
    setDownloading(true);
    const fileBase = asset.name || "asset";
    try {
      const res = await fetch(heroUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = downloadExt(heroUrl, blob.type);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${fileBase}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast.error(t("downloadFailed"));
    } finally {
      setDownloading(false);
    }
  };

  // 轮询生成任务直到完成（mirror ConsistencyVault 的 task 轮询）；失败/超时抛错。
  const pollUntilDone = async (taskId: string): Promise<boolean> => {
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!aliveRef.current) return false;
      let status: { status?: string; error?: string } | undefined;
      try {
        status = await api.getTaskStatus(taskId);
      } catch {
        continue; // 瞬时网络错误：继续轮询
      }
      if (status?.status === "completed") return true;
      if (status?.status === "failed") throw new Error(status.error || t("genFailed"));
    }
    throw new Error(t("genTimeout"));
  };

  // 生成更多变体：仅 project 资产可用（series 无生成端点）。复用按项目 batch 生成管线，
  // 完成后 re-fetch 该项目，把新变体并入本地展示并高亮最新一张。
  const handleGenerateVariants = async () => {
    if (sourceKind !== "project" || generating) return;
    const assetId = asset.id;
    // 父层传入的是列表 key（`project-<id>`）；生成/刷新 API 需要裸 project id。
    const projectId = sourceId.replace(/^project-/, "");
    setGenerating(true);
    const tid = toast.progress(t("generatingVariants"), {
      body: t("generatingVariantsBody", { name: asset.name, count: VARIANT_BATCH }),
    });
    try {
      const resp = await api.generateAsset(
        projectId,
        assetId,
        SINGULAR_TYPE[type],
        "",
        undefined,
        "all",
        "",
        true,
        "",
        VARIANT_BATCH
      );
      const taskId = (resp as { _task_id?: string } | undefined)?._task_id;
      if (taskId) {
        const done = await pollUntilDone(taskId);
        if (!done) return; // 已卸载
      }
      if (!aliveRef.current || currentAssetIdRef.current !== assetId) return;
      const proj = await api.getProject(projectId);
      const list: (Character | Scene | Prop)[] =
        (type === "characters" ? proj?.characters : type === "scenes" ? proj?.scenes : proj?.props) ?? [];
      const updated = list.find((a) => a.id === assetId);
      const freshVariants = (updated ? primaryImageAsset(updated, type)?.variants : undefined) ?? [];
      if (!aliveRef.current || currentAssetIdRef.current !== assetId) return;
      const added = freshVariants.filter((v) => !baseIds.has(v.id));
      setExtraVariants(freshVariants);
      if (added[0]) setActiveVariantId(added[0].id);
      toast.update(tid, {
        kind: "success",
        title: t("variantsGenerated"),
        body: added.length ? t("variantsAddedBody", { count: added.length }) : t("variantsRefreshed"),
        autoCloseMs: 5000,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("genFailed");
      if (aliveRef.current) toast.update(tid, { kind: "error", title: t("variantsGenFailed"), body: msg, autoCloseMs: 0 });
    } finally {
      if (aliveRef.current) setGenerating(false);
    }
  };

  // 提升到全局：把 project/series 来源资产 deep-copy 进全局共享池（global 来源不显示该按钮）。
  // 成功后 toast 并回调父层刷新（新入池资产即出现在「全局 / 共享」分组）。
  const handlePromote = async () => {
    if (sourceKind === "global" || promoting) return;
    // 父层传入的是列表 key（`project-<id>` / `series-<id>`）；promote API 需要裸 id。
    const rawSourceId = sourceId.replace(/^(project|series)-/, "");
    setPromoting(true);
    try {
      await api.promoteAssetToLibrary(sourceKind, rawSourceId, SINGULAR_TYPE[type], asset.id);
      toast.success(t("promoteSuccess"), { body: t("promoteSuccessBody", { name: asset.name }) });
      onPromoted?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("promoteFailed");
      toast.error(t("promoteFailed"), { body: msg });
    } finally {
      setPromoting(false);
    }
  };

  return <aside ref={asideRef} tabIndex={-1} className={styles.inspector} aria-label={t("inspectorAria")}>
    <header className={styles.inspectorHeader}><div><p>{t("inspectorAria")}</p><h2>{asset.name}</h2></div>
      <IconButton aria-label={t("closeInspector")} onPress={onClose}><X size={18} /></IconButton>
    </header>
    {heroUrl && <img src={heroUrl} alt={asset.name} className={styles.hero} />}
    <div className={styles.details}>
      {variants.length > 1 && <section><h3>{t("variantsSection")}</h3><div className={styles.variants}>
        {variants.map((variant, index) => <button key={variant.id} type="button" aria-label={`${t("variantAlt")} ${index + 1}`} aria-pressed={variant.id === activeVariant?.id} onClick={() => setActiveVariantId(variant.id)}><img src={getAssetUrl(variant.url)} alt="" /></button>)}
      </div></section>}
      <dl className={styles.metadata}>{metaRows.map(row => <Fragment key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></Fragment>)}</dl>
      {asset.description && <section><h3>{t("descLabel")}</h3><p className={styles.prompt}>{asset.description}</p></section>}
      {prompt && <section><h3>{t("promptSection")}</h3><p className={styles.prompt}>{prompt}</p></section>}
      <div className={styles.actions}>
        <Button variant="secondary" aria-pressed={starred} isDisabled={starPending} onPress={onToggleStar}><Star size={15} className={starred ? "fill-current" : ""} />{starred ? t("unstar") : t("star")}</Button>
        {sourceKind === "project" ? <Button isPending={generating} onPress={() => void handleGenerateVariants()}><Sparkles size={15} />{generating ? t("generating") : t("generateMoreVariants")}</Button>
          : <p className={styles.prompt}>{t("genInEpisodeTooltip")}</p>}
        {sourceKind !== "global" && <Button variant="secondary" isPending={promoting} onPress={() => void handlePromote()}><Globe size={15} />{promoting ? t("promoting") : t("promoteToGlobal")}</Button>}
        <Button variant="quiet" onPress={() => void handleDownload()} isDisabled={!heroUrl} isPending={downloading}><Download size={15} />{t("download")}</Button>
      </div>
    </div>
  </aside>;
}
