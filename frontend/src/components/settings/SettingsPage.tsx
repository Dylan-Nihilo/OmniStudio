"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Save, RefreshCw, WifiOff, Copy, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { api, type EnvConfigPayload, type LlmProvider, type ProviderMode, API_URL } from "@/lib/api";
import { ASPECT_RATIOS } from "@/store/projectStore";
import {
  DEFAULT_MODEL_SETTINGS,
  GLOBAL_I2V_MODELS,
  GLOBAL_R2V_MODELS,
  GLOBAL_IMAGE_MODELS,
  normalizeModelSettings,
  type FrontendModelSettings,
} from "@/lib/modelCatalog";
import { useSettingsStore, type Locale, type ThemePreset } from "@/store/settingsStore";
import { toast } from "@/store/toastStore";
import { Button, IconButton, LoadingState, SelectField, Tabs, TextAreaField, TextField } from "@omnistudio/ui";
import OmniStudioBranding from "@/components/layout/OmniStudioBranding";
import UpdateChecker from "./UpdateChecker";
import styles from "./SettingsPage.module.css";
type SettingsCategory = "general" | "models" | "prompts" | "apikeys" | "storage" | "about";
import { SectionCard as Section, FormRow, KeyField, Toggle } from "./SettingsControls";

const APP_VERSION = "v0.2.0";

type EnvConfig = EnvConfigPayload & {
  LLM_PROVIDER: LlmProvider;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;
  OPENAI_MODEL: string;
  DASHSCOPE_API_KEY: string;
  ALIBABA_CLOUD_ACCESS_KEY_ID: string;
  ALIBABA_CLOUD_ACCESS_KEY_SECRET: string;
  OSS_ENABLE: boolean;
  OSS_BUCKET_NAME: string;
  OSS_ENDPOINT: string;
  OSS_BASE_PATH: string;
  KLING_PROVIDER_MODE: ProviderMode;
  VIDU_PROVIDER_MODE: ProviderMode;
  PIXVERSE_PROVIDER_MODE: ProviderMode;
  KLING_ACCESS_KEY: string;
  KLING_SECRET_KEY: string;
  VIDU_API_KEY: string;
  MULEROUTER_API_KEY: string;
  MULERUN_CLI_LOGGED_IN?: boolean;
  endpoint_overrides: Record<string, string>;
};

const ENDPOINT_PROVIDERS = [
  { key: "DASHSCOPE_BASE_URL", label: "DashScope", placeholder: "https://dashscope.aliyuncs.com" },
  { key: "KLING_BASE_URL", label: "Kling", placeholder: "https://api-beijing.klingai.com/v1" },
  { key: "VIDU_BASE_URL", label: "Vidu", placeholder: "https://api.vidu.cn/ent/v2" },
  { key: "MULEROUTER_BASE_URL", label: "MuleRouter", placeholder: "https://api.mulerouter.ai" },
];

const DEFAULT_CONFIG: EnvConfig = {
  LLM_PROVIDER: "dashscope",
  OPENAI_API_KEY: "",
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  OPENAI_MODEL: "gpt-4o",
  DASHSCOPE_API_KEY: "",
  ALIBABA_CLOUD_ACCESS_KEY_ID: "",
  ALIBABA_CLOUD_ACCESS_KEY_SECRET: "",
  OSS_ENABLE: true,
  OSS_BUCKET_NAME: "",
  OSS_ENDPOINT: "",
  OSS_BASE_PATH: "",
  KLING_PROVIDER_MODE: "dashscope",
  VIDU_PROVIDER_MODE: "dashscope",
  PIXVERSE_PROVIDER_MODE: "dashscope",
  KLING_ACCESS_KEY: "",
  KLING_SECRET_KEY: "",
  VIDU_API_KEY: "",
  MULEROUTER_API_KEY: "",
  endpoint_overrides: {},
};

const normalizeProviderMode = (mode?: string): ProviderMode => (mode === "vendor" ? "vendor" : "dashscope");
const normalizeLlmProvider = (provider?: string): LlmProvider => (provider === "openai" ? "openai" : "dashscope");

const normalizeEnvConfig = (existing: EnvConfig, data?: EnvConfigPayload): EnvConfig => ({
  ...existing,
  ...data,
  LLM_PROVIDER: normalizeLlmProvider(data?.LLM_PROVIDER ?? existing.LLM_PROVIDER),
  OPENAI_BASE_URL: data?.OPENAI_BASE_URL || existing.OPENAI_BASE_URL || "https://api.openai.com/v1",
  OPENAI_MODEL: data?.OPENAI_MODEL || existing.OPENAI_MODEL || "gpt-4o",
  KLING_PROVIDER_MODE: normalizeProviderMode(data?.KLING_PROVIDER_MODE ?? existing.KLING_PROVIDER_MODE),
  VIDU_PROVIDER_MODE: normalizeProviderMode(data?.VIDU_PROVIDER_MODE ?? existing.VIDU_PROVIDER_MODE),
  PIXVERSE_PROVIDER_MODE: normalizeProviderMode(data?.PIXVERSE_PROVIDER_MODE ?? existing.PIXVERSE_PROVIDER_MODE),
  endpoint_overrides: data?.endpoint_overrides ?? existing.endpoint_overrides ?? {},
});

const getValidationErrors = (env: EnvConfig): string[] => {
  const errors: string[] = [];
  const activeLlmKey = env.LLM_PROVIDER === "openai" ? env.OPENAI_API_KEY : env.DASHSCOPE_API_KEY;
  if (!activeLlmKey?.trim()) {
    errors.push(env.LLM_PROVIDER === "openai" ? "OpenAI-compatible API Key" : "DashScope API Key");
  }
  if (env.KLING_PROVIDER_MODE === "vendor") {
    if (!env.KLING_ACCESS_KEY?.trim()) errors.push("Kling Access Key (vendor mode)");
    if (!env.KLING_SECRET_KEY?.trim()) errors.push("Kling Secret Key (vendor mode)");
  }
  if (env.VIDU_PROVIDER_MODE === "vendor" && !env.VIDU_API_KEY?.trim()) {
    errors.push("Vidu API Key (vendor mode)");
  }
  return errors;
};

const STORAGE_FIELDS = ['OSS_ENABLE', 'OSS_BUCKET_NAME', 'OSS_ENDPOINT', 'OSS_BASE_PATH', 'ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET'] as const;
const PROVIDER_FIELDS = ['LLM_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'DASHSCOPE_API_KEY', 'KLING_PROVIDER_MODE', 'VIDU_PROVIDER_MODE', 'KLING_ACCESS_KEY', 'KLING_SECRET_KEY', 'VIDU_API_KEY', 'MULEROUTER_API_KEY'] as const;

const LS_KEY_MODEL = "omni_studio_default_model_settings";
const LS_KEY_PROMPT = "omni_studio_default_prompt_config";

interface DefaultPromptConfig {
  storyboard_polish: string;
  video_polish: string;
  r2v_polish: string;
  entity_extraction: string;
  style_analysis: string;
  storyboard_extraction: string;
}

const EMPTY_PROMPT_CONFIG: DefaultPromptConfig = {
  storyboard_polish: "",
  video_polish: "",
  r2v_polish: "",
  entity_extraction: "",
  style_analysis: "",
  storyboard_extraction: "",
};

function loadFromLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

// `name` / `desc` hold i18n keys (relative to the `settings` namespace) so the
// module-scope list can be resolved with t(...) at render time.
const THEME_OPTIONS: { id: ThemePreset; name: string; desc: string }[] = [
  { id: "v3-paper",      name: "themeV3Paper",      desc: "themeV3PaperDesc" },
  { id: "atelier-dark",  name: "themeAtelierDark",  desc: "themeAtelierDarkDesc" },
  { id: "bridge-dark",   name: "themeBridgeDark",   desc: "themeBridgeDarkDesc" },
  { id: "brand-dark",    name: "themeBrandDark",    desc: "themeBrandDarkDesc" },
  { id: "atelier-light", name: "themeAtelierLight", desc: "themeAtelierLightDesc" },
  { id: "brand-light",   name: "themeBrandLight",   desc: "themeBrandLightDesc" },
];

interface SystemReport {
  ffmpeg?: { available: boolean; message: string; path: string | null };
  status?: string;
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const { locale, theme, animations, setLocale, setTheme, setAnimations } = useSettingsStore();

  const [active, setActive] = useState<SettingsCategory>("general");

  // ── API Config ──
  const [config, setConfig] = useState<EnvConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const savedConfigRef = useRef<EnvConfig>(DEFAULT_CONFIG);
  const configRequest = useRef(0);
  const mounted = useRef(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const clearFeedback = () => { setSaveError(null); setSaved(false); };

  // ── Default Model Settings ──
  const [modelSettings, setModelSettings] = useState<FrontendModelSettings>(() =>
    normalizeModelSettings(loadFromLS(LS_KEY_MODEL, DEFAULT_MODEL_SETTINGS), "global_settings")
  );

  // ── Default Prompt Config ──
  // `promptConfig` is the displayed/editable text. localStorage (LS_KEY_PROMPT)
  // only ever stores DELTAS: an empty value means "use the built-in default".
  // `promptDefaults` holds the real built-in defaults fetched from the backend
  // so we can pre-fill the fields and run the delta comparison on save.
  const [promptConfig, setPromptConfig] = useState<DefaultPromptConfig>(() =>
    loadFromLS(LS_KEY_PROMPT, EMPTY_PROMPT_CONFIG)
  );
  const editedPrompts = useRef(new Set<keyof DefaultPromptConfig>());
  const [promptDefaults, setPromptDefaults] = useState<Record<string, string>>({});

  // ── About / system ──
  const [online, setOnline] = useState(true);
  const [dataDir, setDataDir] = useState<string>("");
  const [logDir, setLogDir] = useState<string>("");
  const [system, setSystem] = useState<SystemReport | null>(null);
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemChecked, setSystemChecked] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    const request = ++configRequest.current;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.getEnvConfig();
      if (!mounted.current || request !== configRequest.current) return;
      const loaded = normalizeEnvConfig(DEFAULT_CONFIG, data);
      savedConfigRef.current = loaded;
      setConfig(loaded);
    } catch {
      if (mounted.current && request === configRequest.current) setLoadError(t("loadConfigFailed"));
    } finally {
      if (mounted.current && request === configRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadConfig();
    return () => { mounted.current = false; configRequest.current += 1; };
  }, [loadConfig]);

  // Pre-fill the prompt fields with the real built-in defaults so users can see
  // and edit from them. We remember the fetched defaults for the delta-save
  // comparison, and only fill a field the user has NOT overridden (empty in LS).
  // If the fetch fails we leave the fields empty (placeholder) — no crash.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const defaults = await api.fetchPromptDefaults();
        if (cancelled || !defaults) return;
        setPromptDefaults(defaults);
        setPromptConfig((prev) => {
          const next = { ...prev };
          (Object.keys(EMPTY_PROMPT_CONFIG) as (keyof DefaultPromptConfig)[]).forEach((k) => {
            const d = defaults[k];
            if (typeof d === "string" && d && !prev[k] && !editedPrompts.current.has(k)) next[k] = d;
          });
          return next;
        });
      } catch {
        /* defaults unavailable — fields fall back to empty placeholders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Online/offline detection for the banner.
  useEffect(() => {
    const update = () => setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Pull health (data/log dir) once on mount so About + Storage can show paths.
  useEffect(() => {
    (async () => {
      try {
        const h = await api.healthCheck();
        if (!mounted.current) return;
        if (h.log_dir) setLogDir(h.log_dir);
        if (h.log_file) {
          // data dir = parent of logs dir (logs lives under <data>/logs)
          const dir = h.log_dir.replace(/\/logs\/?$/, "");
          setDataDir(dir || h.log_dir);
        }
      } catch {
        /* backend offline — About shows fallback */
      }
    })();
  }, []);

  const loadSystem = useCallback(async () => {
    setSystemLoading(true);
    try {
      const r = await api.checkSystem();
      if (!mounted.current) return;
      setSystem({ ffmpeg: r.dependencies?.ffmpeg, status: r.status });
      // Lock only on success so a recovered backend is reflected without
      // forcing a manual retry, while a successful read won't re-run.
      setSystemChecked(true);
    } catch {
      if (mounted.current) setSystem(null);
      // Leave systemChecked=false: re-entering the About tab retries once.
    } finally {
      if (mounted.current) setSystemLoading(false);
    }
  }, []);

  // Self-healing lazy load: auto-run the system check when the About tab
  // becomes active and we don't yet have a successful result. Driven off a
  // tab-transition ref so it fires once per entry (no render thrash) and is
  // not retried endlessly while the result is missing.
  const prevActiveRef = useRef<SettingsCategory | null>(null);
  useEffect(() => {
    const enteredAbout = active === "about" && prevActiveRef.current !== "about";
    prevActiveRef.current = active;
    if (active === "about" && !systemChecked && !systemLoading && enteredAbout) {
      loadSystem();
    }
  }, [active, systemChecked, systemLoading, loadSystem]);

  const saveEnvScope = async (scope: 'apikeys' | 'storage') => {
    if (saving || loading || loadError || !online) return;
    clearFeedback();
    if (scope === 'apikeys') {
      const errors = getValidationErrors(config);
      if (errors.length) { setSaveError(`${t('fillRequired')}: ${errors.join(', ')}`); return; }
    }
    const fields = scope === 'storage' ? STORAGE_FIELDS : PROVIDER_FIELDS;
    const payload: EnvConfigPayload = {};
    for (const key of fields) {
      const value = config[key];
      if (value !== savedConfigRef.current[key] && !(typeof value === 'string' && value.includes('•'))) Object.assign(payload, { [key]: value });
    }
    if (scope === 'apikeys') {
      const endpoints = Object.fromEntries(Object.entries(config.endpoint_overrides).filter(([key,value]) => value !== savedConfigRef.current.endpoint_overrides[key]));
      if (Object.keys(endpoints).length) payload.endpoint_overrides = endpoints;
    }
    if (!Object.keys(payload).length) { setSaved(true); return; }
    setSaving(true);
    try {
      await api.saveEnvConfig(payload);
      if (!mounted.current) return;
      savedConfigRef.current = normalizeEnvConfig(savedConfigRef.current, {
        ...payload,
        endpoint_overrides: {...savedConfigRef.current.endpoint_overrides, ...payload.endpoint_overrides},
      });
      setSaved(true);
      toast.success(t('saveSuccess'));
    } catch {
      if (mounted.current) setSaveError(t('saveConfigFailed'));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  const handleSaveApiConfig = () => saveEnvScope('apikeys');
  const handleSaveStorage = () => saveEnvScope('storage');

  const handleChange = (key: keyof EnvConfig, value: string) => {
    clearFeedback();
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleEndpointChange = (envKey: string, value: string) => {
    clearFeedback();
    setConfig((prev) => ({
      ...prev,
      endpoint_overrides: { ...prev.endpoint_overrides, [envKey]: value },
    }));
  };

  const handleSaveModelDefaults = () => {
    const normalized = normalizeModelSettings(modelSettings, "global_settings");
    // T2I and I2I share one image model in the UI; persist both backend
    // fields plus image_model so per-project backfill stays consistent.
    const merged: FrontendModelSettings = {
      ...normalized,
      i2i_model: normalized.t2i_model,
      image_model: normalized.t2i_model,
    };
    clearFeedback();
    try {
      localStorage.setItem(LS_KEY_MODEL, JSON.stringify(merged));
      setModelSettings(merged);
      setSaved(true);
    } catch { setSaveError(t("saveLocalFailed")); }
  };

  const handleSavePromptDefaults = () => {
    // DELTA persistence: a field equal to its built-in default is stored as ""
    // (=> use built-in, no snapshot pinning); only genuine overrides are saved.
    const delta: DefaultPromptConfig = { ...EMPTY_PROMPT_CONFIG };
    (Object.keys(EMPTY_PROMPT_CONFIG) as (keyof DefaultPromptConfig)[]).forEach((k) => {
      const text = promptConfig[k] ?? "";
      delta[k] = text === promptDefaults[k] ? "" : text;
    });
    clearFeedback();
    try {
      localStorage.setItem(LS_KEY_PROMPT, JSON.stringify(delta));
      setSaved(true);
    } catch { setSaveError(t("saveLocalFailed")); }
  };

  const copyPath = async (path: string) => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
    } catch { toast.error(t("copyFailed")); }
  };

  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const loginRun = useRef(0);
  const loginPoll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loginTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopLogin = useCallback(() => {
    loginRun.current += 1;
    if (loginPoll.current) clearTimeout(loginPoll.current);
    if (loginTimeout.current) clearTimeout(loginTimeout.current);
  }, []);
  useEffect(() => stopLogin, [stopLogin]);

  const startLogin = async () => {
    if (loginPending || !online || saving) return;
    stopLogin();
    const run = loginRun.current;
    setLoginPending(true);
    setLoginError(null);
    const current = () => mounted.current && run === loginRun.current;
    const finish = (error?: string) => {
      if (!current()) return;
      stopLogin();
      setLoginPending(false);
      setLoginError(error || null);
    };
    loginTimeout.current = setTimeout(() => finish(t("loginTimedOut")), 120000);
    try {
      await api.triggerMulerunLogin();
      if (!current()) return;
      const poll = async () => {
        try {
          const env = await api.getEnvConfig();
          if (!current()) return;
          if (env.MULERUN_CLI_LOGGED_IN) {
            setConfig(c => ({...c, MULERUN_CLI_LOGGED_IN:true}));
            finish();
            return;
          }
        } catch { /* Retry while the user completes browser login. */ }
        if (current()) loginPoll.current = setTimeout(poll, 3000);
      };
      loginPoll.current = setTimeout(poll, 3000);
    } catch { finish(t("loginFailed")); }
  };

  const pathField = (label: string, value: string) => <div className="flex items-end gap-2">
    <TextField label={label} value={value || "—"} isReadOnly className="min-w-0 flex-1 [&_input]:font-mono" />
    <IconButton aria-label={`${t("copyPath")} · ${label}`} isDisabled={!value} onPress={() => copyPath(value)}>
      {copiedPath === value && value ? <Check size={16} /> : <Copy size={16} />}
    </IconButton>
  </div>;
  const keyField = (key: keyof EnvConfig, label: string, placeholder?: string) => <KeyField label={label} value={String(config[key] || "")} onChange={value => handleChange(key, value)} placeholder={placeholder} isDisabled={saving} />;
  const envField = (key: keyof EnvConfig, label: string, placeholder?: string, type: "text" | "url" = "text") => <TextField label={label} value={String(config[key] || "")} onChange={value => handleChange(key, value)} placeholder={placeholder} type={type} isDisabled={saving} className="[&_input]:font-mono" />;
  const updateModel = (key: keyof FrontendModelSettings, value: string) => {
    clearFeedback();
    setModelSettings(s => key === "t2i_model" ? {...s, t2i_model:value, i2i_model:value, image_model:value} : {...s, [key]:value});
  };
  const ratioField = (key: keyof FrontendModelSettings, label: string) => <SelectField label={label} value={String(modelSettings[key])} onChange={value => updateModel(key, String(value))} options={ASPECT_RATIOS.map(r => ({id:r.id, label:r.name}))} />;

  const renderGeneral = () => <Section id="general" title={t("secGeneralTitle")}>
    <FormRow label={t("language")} hint={t("languageDesc")}>
      <SelectField label={t("language")} className="[&>.label]:sr-only" value={locale} onChange={value => setLocale(value as Locale)} options={[{id:"zh", label:t("chinese")}, {id:"en", label:t("english")}]} />
    </FormRow>
    <FormRow label={t("theme")} hint={t("themeDesc")}>
      <SelectField label={t("theme")} className="[&>.label]:sr-only" value={theme} onChange={value => setTheme(value as ThemePreset)} options={THEME_OPTIONS.map(p => ({id:p.id, label:t(p.name), description:t(p.desc)}))} />
    </FormRow>
    <FormRow label={t("motionLabel")} hint={t("motionHint")}>
      <Toggle checked={animations} onChange={setAnimations} label={animations ? t("motionOn") : t("motionReduced")} sub={t("motionSub")} ariaLabel={t("motionToggleAria")} />
    </FormRow>
  </Section>;

  const renderModels = () => <Section id="models" title={t("secModelsTitle")} desc={t("secModelsDesc")}>
    <FormRow label={t("imageModelLabel")} hint={t("imageModelHint")}>
      <SelectField label={t("imageModelLabel")} className="[&>.label]:sr-only" value={modelSettings.t2i_model} onChange={value => updateModel("t2i_model", String(value))} options={GLOBAL_IMAGE_MODELS.map(m => ({id:m.id, label:m.name, description:m.description}))} />
    </FormRow>
    <FormRow label={t("assetAspectLabel")} hint={t("assetAspectHint")}>
      <div className="grid gap-4 sm:grid-cols-3">
        {ratioField("character_aspect_ratio", t("assetCharacter"))}
        {ratioField("scene_aspect_ratio", t("assetScene"))}
        {ratioField("prop_aspect_ratio", t("assetProp"))}
      </div>
    </FormRow>
    <FormRow label={t("storyboardAspectLabel")} hint={t("storyboardAspectHint")}>{ratioField("storyboard_aspect_ratio", t("storyboardAspectLabel"))}</FormRow>
    <FormRow label={t("i2vModelLabel")} hint={t("i2vModelHint")}>
      <SelectField label={t("i2vModelLabel")} className="[&>.label]:sr-only" value={modelSettings.i2v_model} onChange={value => updateModel("i2v_model", String(value))} options={GLOBAL_I2V_MODELS.map(m => ({id:m.id, label:m.name, description:m.description}))} />
    </FormRow>
    <FormRow label={t("r2vModelLabel")} hint={t("r2vModelHint")}>
      <SelectField label={t("r2vModelLabel")} className="[&>.label]:sr-only" value={modelSettings.r2v_model} onChange={value => updateModel("r2v_model", String(value))} options={GLOBAL_R2V_MODELS.map(m => ({id:m.id, label:m.name, description:m.description}))} />
    </FormRow>
  </Section>;

  const PROMPT_FIELDS: { key: keyof DefaultPromptConfig; label: string; desc: string }[] = [
    { key: "entity_extraction", label: t("promptEntityLabel"), desc: t("promptEntityDesc") },
    { key: "style_analysis", label: t("promptStyleLabel"), desc: t("promptStyleDesc") },
    { key: "storyboard_extraction", label: t("promptStoryboardExtractLabel"), desc: t("promptStoryboardExtractDesc") },
    { key: "storyboard_polish", label: t("promptStoryboardPolishLabel"), desc: t("promptStoryboardPolishDesc") },
    { key: "video_polish", label: t("promptVideoPolishLabel"), desc: t("promptVideoPolishDesc") },
    { key: "r2v_polish", label: t("promptR2vPolishLabel"), desc: t("promptR2vPolishDesc") },
  ];
  const renderPrompts = () => <Section id="prompts" title={t("secPromptsTitle")} desc={t("secPromptsDesc")}>
    {PROMPT_FIELDS.map(f => <FormRow key={f.key} label={f.label} hint={f.desc}>
      <TextAreaField label={f.label} className="[&>.label]:sr-only [&_textarea]:font-mono" rows={6} value={promptConfig[f.key]} onChange={value => {editedPrompts.current.add(f.key); clearFeedback(); setPromptConfig(prev => ({...prev, [f.key]:value}));}} placeholder={t("promptPlaceholder")} />
    </FormRow>)}
  </Section>;

  const configGuard = loading ? <LoadingState label={t("loadingConfig")} className="py-12" /> : loadError ? <div role="alert" className="flex flex-wrap items-center gap-4 py-8 text-sm text-status-failed-fg">{loadError}<Button variant="secondary" onPress={loadConfig}>{t("retryLoad")}</Button></div> : null;
  const vendorOptions = [{id:"dashscope", label:"DashScope"}, {id:"vendor", label:t("vendorDirect")}];
  const renderApiKeys = () => <Section id="apikeys" title={t("secApiTitle")} desc={t("secApiDesc")}>
    {configGuard || <>
      <FormRow label={t("llmProviderLabel")} hint={t("llmProviderHint")}>
        <SelectField label={t("llmProviderLabel")} className="[&>.label]:sr-only" value={config.LLM_PROVIDER} onChange={value => handleChange("LLM_PROVIDER", String(value))} isDisabled={saving} options={[{id:"dashscope", label:"DashScope"}, {id:"openai", label:t("openaiCompatible")}]} />
      </FormRow>
      {config.LLM_PROVIDER === "openai" ? <FormRow label={t("openaiKeyLabel")} hint={t("openaiKeyHint")}>
        <div className="space-y-4">
          {keyField("OPENAI_API_KEY", t("openaiKeyLabel"), "sk-...")}
          {envField("OPENAI_BASE_URL", t("openaiBaseUrlLabel"), "https://api.openai.com/v1", "url")}
          {envField("OPENAI_MODEL", t("openaiModelLabel"), "gpt-4o")}
        </div>
      </FormRow> : <FormRow label={t("dashscopeKeyLabel")} hint={t("dashscopeKeyHint")}>{keyField("DASHSCOPE_API_KEY", "DashScope API Key", "sk-...")}</FormRow>}
      <FormRow label={t("klingLabel")} hint={t("klingHint")}>
        <div className="space-y-4">
          <SelectField label={t("klingProvider")} value={config.KLING_PROVIDER_MODE} onChange={value => handleChange("KLING_PROVIDER_MODE", String(value))} options={vendorOptions} isDisabled={saving} />
          {config.KLING_PROVIDER_MODE === "vendor" && <>{keyField("KLING_ACCESS_KEY", "Kling Access Key")}{keyField("KLING_SECRET_KEY", "Kling Secret Key")}</>}
        </div>
      </FormRow>
      <FormRow label="Vidu" hint={t("viduHint")}>
        <div className="space-y-4">
          <SelectField label={t("viduProvider")} value={config.VIDU_PROVIDER_MODE} onChange={value => handleChange("VIDU_PROVIDER_MODE", String(value))} options={vendorOptions} isDisabled={saving} />
          {config.VIDU_PROVIDER_MODE === "vendor" && keyField("VIDU_API_KEY", "Vidu API Key")}
        </div>
      </FormRow>
      <FormRow label={t("mulerunLabel")} hint={t("mulerunHint")}>
        <div className="space-y-4">
          {!config.MULEROUTER_API_KEY && <div className="space-y-3">
            {config.MULERUN_CLI_LOGGED_IN && <p role="status" className="flex items-center gap-2 text-sm text-status-completed-fg"><Check size={16} />{t("mulerunLoggedIn")}</p>}
            <Button variant="secondary" onPress={startLogin} isPending={loginPending} isDisabled={saving || !online}>{loginPending ? t("loginWaiting") : config.MULERUN_CLI_LOGGED_IN ? t("reLogin") : t("mulerunLogin")}</Button>
          </div>}
          {loginError && <p role="alert" className="text-sm text-status-failed-fg">{loginError}</p>}
          {keyField("MULEROUTER_API_KEY", "MuleRouter API Key", "muk-...")}
          <details className="text-sm">
            <summary className="cursor-pointer text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{t("manualGetKey")}</summary>
            <ol className="mt-4 space-y-3">
              {[{label:t("stepInstallCli"), cmd:"npm i -g @mulerunai/cli"}, {label:t("stepBrowserLogin"), cmd:"mulerun login"}, {label:t("stepCopyKey"), cmd:"mulerun studio config"}].map((step, index) => <li key={step.cmd} className="flex flex-wrap items-center gap-2"><span className="text-text-muted">{index + 1}. {step.label}</span><code className="break-all rounded bg-surface px-2 py-1 font-mono text-xs select-all">{step.cmd}</code><IconButton aria-label={`${t("copy")} ${step.cmd}`} onPress={() => copyPath(step.cmd)}>{copiedPath === step.cmd ? <Check size={14} /> : <Copy size={14} />}</IconButton></li>)}
            </ol>
            <p className="mt-3 text-xs leading-6 text-text-muted">{t("mulerunKeyHint")}</p>
          </details>
        </div>
      </FormRow>
      <FormRow label={t("advancedEndpointsLabel")} hint={t("advancedEndpointsHint")}>
        <details><summary className="cursor-pointer text-sm text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{t("expandEndpoints")}</summary>
          <div className="mt-4 space-y-4">{ENDPOINT_PROVIDERS.map(({key, label, placeholder}) => <TextField key={key} label={`${label} Base URL`} type="url" value={config.endpoint_overrides[key] || ""} onChange={value => handleEndpointChange(key, value)} placeholder={placeholder} isDisabled={saving} className="[&_input]:font-mono" />)}</div>
        </details>
      </FormRow>
    </>}
  </Section>;

  const renderStorage = () => <Section id="storage" title={t("secStorageTitle")} desc={t("secStorageDesc")}>
    {configGuard || <>
      <FormRow label={t("cloudStorageLabel")}>
        <Toggle checked={config.OSS_ENABLE} onChange={value => {clearFeedback(); setConfig(c => ({...c, OSS_ENABLE:value}));}} label={t("enableCloudStorage")} sub={t("enableCloudStorageSub")} ariaLabel={t("enableCloudStorageAria")} isDisabled={saving} />
      </FormRow>
      <FormRow label={t("ossAkSkLabel")} hint={t("ossAkSkHint")}>
        <div className="space-y-4">{keyField("ALIBABA_CLOUD_ACCESS_KEY_ID", "Access Key ID", t("ossOptionalMirror"))}{keyField("ALIBABA_CLOUD_ACCESS_KEY_SECRET", "Access Key Secret", t("ossOptionalMirror"))}
          <a href="https://help.aliyun.com/zh/ram/user-guide/create-an-accesskey-pair" target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-primary underline underline-offset-4">{t("howToGetAccessKey")}</a>
        </div>
      </FormRow>
      <FormRow label={t("bucketLabel")} hint={t("bucketHint")}>{envField("OSS_BUCKET_NAME", t("bucketLabel"), t("bucketPlaceholder"))}</FormRow>
      <FormRow label="Endpoint" hint={t("endpointHint")}>{envField("OSS_ENDPOINT", "OSS Endpoint", t("endpointPlaceholder"))}</FormRow>
      <FormRow label="Base Path" hint={t("basePathHint")}>{envField("OSS_BASE_PATH", "Base Path", "omni-studio")}</FormRow>
      <FormRow label={t("dataDirLabel")} hint={t("dataDirHint")}>{pathField(t("dataDirLabel"), dataDir)}</FormRow>
      <FormRow label={t("logDirLabel")} hint={t("logDirHint")}>{pathField(t("logDirLabel"), logDir)}</FormRow>
    </>}
  </Section>;

  const renderAbout = () => <Section id="about" title={t("secAboutTitle")}>
    <div className="py-6"><OmniStudioBranding size="md" showSlogan={false} /><p className="mt-3 text-sm text-text-muted">{t("aboutTagline")}</p></div>
    <UpdateChecker />
    <FormRow label={t("aboutAppVersion")}><span className="font-mono text-sm">Omni Studio {APP_VERSION}</span></FormRow>
    <FormRow label={t("aboutBackendApi")}><span className="break-all font-mono text-sm">{API_URL}</span></FormRow>
    <FormRow label={t("aboutDataDir")}>{pathField(t("aboutDataDir"), dataDir)}</FormRow>
    <FormRow label={t("aboutLogDir")}>{pathField(t("aboutLogDir"), logDir)}</FormRow>
    <FormRow label="FFmpeg"><div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-sm text-text-secondary">{systemLoading ? t("ffmpegChecking") : system?.ffmpeg ? system.ffmpeg.available ? t("ffmpegAvailable") : t("ffmpegMissing") : t("ffmpegUnknown")}</p>
      <Button variant="secondary" onPress={loadSystem} isPending={systemLoading}><RefreshCw size={16} />{t("recheck")}</Button>
    </div></FormRow>
  </Section>;

  const tabs: { id: SettingsCategory; label: string }[] = [
    {id:"general", label:t("tabGeneral")}, {id:"models", label:t("tabModels")}, {id:"prompts", label:t("tabPrompts")},
    {id:"apikeys", label:t("tabApikeys")}, {id:"storage", label:t("tabStorage")}, {id:"about", label:t("tabAbout")},
  ];
  const titles = {general:t("eyebrowGeneral"), models:t("eyebrowModels"), prompts:t("eyebrowPrompts"), apikeys:t("eyebrowApikeys"), storage:t("eyebrowStorage"), about:t("eyebrowAbout")};
  const renderers = {general:renderGeneral, models:renderModels, prompts:renderPrompts, apikeys:renderApiKeys, storage:renderStorage, about:renderAbout};
  const saveAction = active === "models" ? handleSaveModelDefaults : active === "prompts" ? handleSavePromptDefaults : active === "apikeys" ? handleSaveApiConfig : active === "storage" ? handleSaveStorage : undefined;
  const remoteConfig = active === "apikeys" || active === "storage";
  const selectCategory = (value: string) => { clearFeedback(); setActive(value as SettingsCategory); };
  return <div className="relative flex h-full min-w-0 flex-col bg-background text-foreground">
    <header className="flex min-h-24 shrink-0 items-center justify-between gap-4 border-b border-glass-border px-4 py-4 md:px-8">
      <div className="min-w-0"><p className="text-xs text-text-muted">{t("title")}</p><h1 className="mt-1 text-xl font-semibold tracking-tight">{titles[active]}</h1></div>
      {saveAction ? <Button variant="primary" onPress={saveAction} isPending={saving} isDisabled={remoteConfig && (loading || Boolean(loadError) || !online)}><Save size={16} />{saving ? t("saving") : remoteConfig ? t("saveConfig") : t("saveDefaults")}</Button> : active === "general" ? <span className="text-xs text-text-muted">{t("appliesImmediately")}</span> : null}
    </header>
    {saveError && <p role="alert" className="shrink-0 bg-status-failed-bg px-4 py-3 text-sm text-status-failed-fg md:px-8">{saveError}</p>}
    {saved && <p role="status" className="flex shrink-0 items-center gap-2 px-4 py-3 text-sm text-status-completed-fg md:px-8"><Check size={16} />{t("saved")}</p>}
    <div className="shrink-0 px-4 pt-4 md:px-8 sm:hidden"><SelectField label={t("tabsAria")} value={active} onChange={value => selectCategory(String(value))} options={tabs} isDisabled={saving} /></div>
    <Tabs aria-label={t("tabsAria")} selectedKey={active} onSelectionChange={key => selectCategory(String(key))} className={`${styles.tabs} px-4 md:px-8`} items={tabs.map(tab => ({...tab, isDisabled:saving, content:active === tab.id ? <div className="max-w-6xl">
      {!online && <div role="status" className="mb-5 flex items-center gap-3 rounded-lg border border-glass-border bg-surface p-4 text-sm"><WifiOff size={18} /><div><p>{t("offlineTitle")}</p><p className="mt-1 text-xs text-text-muted">{t("offlineSettingsBody")}</p></div></div>}
      {renderers[active]()}
    </div> : null}))} />
  </div>;
}
