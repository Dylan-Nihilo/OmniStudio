import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Featured (best-of-batch) persistence — client-side localStorage only.
// Map of generationId -> the one outputId marked "featured" within that batch.
// ---------------------------------------------------------------------------

const FEATURED_LS_KEY = 'omni_studio:playground:featured';

function loadFeatured(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(FEATURED_LS_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function saveFeatured(map: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FEATURED_LS_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / serialization errors */
  }
}

// ---------------------------------------------------------------------------
// Generation queue — client-side concurrency gate. Default concurrency is
// persisted to localStorage; queued ids use a simple module counter.
// ---------------------------------------------------------------------------

const CONCURRENCY_LS_KEY = 'omni_studio:playground:concurrency';
const DEFAULT_CONCURRENCY = 3;

function loadConcurrency(): number {
  if (typeof window === 'undefined') return DEFAULT_CONCURRENCY;
  const raw = Number(window.localStorage.getItem(CONCURRENCY_LS_KEY));
  return Number.isFinite(raw) && raw >= 1 && raw <= 8 ? raw : DEFAULT_CONCURRENCY;
}

function saveConcurrency(n: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONCURRENCY_LS_KEY, String(n));
  } catch {
    /* ignore */
  }
}

let queueSeq = 0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlaygroundMode = 't2i' | 'i2i' | 't2v' | 'i2v' | 'r2v' | 'v2v';

export interface PlaygroundOutput {
  id: string;
  media_path: string;
  media_type: 'image' | 'video';
  thumbnail_path?: string;
  saved_to_library: boolean;
}

export interface PlaygroundGeneration {
  id: string;
  mode: PlaygroundMode;
  model_id: string;
  prompt: string;
  negative_prompt?: string;
  input_media: string[];
  parameters: Record<string, any>;
  batch_size: number;
  outputs: PlaygroundOutput[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  created_at: string;
}

export interface PlaygroundTemplate {
  id: string;
  name: string;
  category: string;
  prompt: string;
  negative_prompt?: string;
  default_mode?: PlaygroundMode;
  default_model_id?: string;
  default_parameters: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface QueuedRequest {
  id: string;
  mode: PlaygroundMode;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  inputMedia: string[];
  parameters: Record<string, any>;
  batchSize: number;
  status: 'pending' | 'dispatching';
  enqueuedAt: number;
}

// ---------------------------------------------------------------------------
// State & Actions
// ---------------------------------------------------------------------------

interface PlaygroundState {
  // Current input
  mode: PlaygroundMode;
  modelId: string;
  prompt: string;
  negativePrompt: string;
  inputMedia: string[];
  parameters: Record<string, any>;
  batchSize: number;

  // Model preferences (mode -> last used modelId)
  modelPreferences: Partial<Record<PlaygroundMode, string>>;

  // History
  history: PlaygroundGeneration[];

  // Templates
  templates: PlaygroundTemplate[];

  // UI
  isGenerating: boolean;
  activeGenerationIds: string[];
  showAdvancedParams: boolean;
  showTemplateModal: boolean;
  showHistoryDrawer: boolean;

  // Template favorites (local, not persisted to backend)
  favoriteTemplateIds: string[];
  toggleTemplateFavorite: (id: string) => void;
  isTemplateFavorited: (id: string) => boolean;

  // Featured output per generation (best-of-batch); one per batch, localStorage-persisted
  featuredByGen: Record<string, string>;
  toggleFeatured: (genId: string, outputId: string) => void;
  isFeatured: (genId: string, outputId: string) => boolean;

  // Generation queue (client-side concurrency gate)
  queue: QueuedRequest[];
  maxConcurrent: number;
  enqueueRequest: (req: Omit<QueuedRequest, 'id' | 'status' | 'enqueuedAt'>) => void;
  markDispatching: (id: string) => void;
  removeFromQueue: (id: string) => void;
  setMaxConcurrent: (n: number) => void;

  // Actions — input setters
  setMode: (mode: PlaygroundMode) => void;
  setModelId: (modelId: string) => void;
  setPrompt: (prompt: string) => void;
  setNegativePrompt: (neg: string) => void;
  setInputMedia: (media: string[]) => void;
  /** Push a generated result back into the compose panel as reference input,
   *  switching to the appropriate mode. Image → i2i (default) or i2v when an
   *  explicit targetMode is given; video → v2v. Respects per-mode model
   *  preference (same behavior as setMode). */
  useResultAsReference: (
    mediaPath: string,
    mediaType: 'image' | 'video',
    targetMode?: PlaygroundMode,
  ) => void;
  setParameters: (params: Record<string, any>) => void;
  setBatchSize: (size: number) => void;
  setShowAdvancedParams: (show: boolean) => void;
  setShowTemplateModal: (show: boolean) => void;
  setShowHistoryDrawer: (show: boolean) => void;

  // Actions — generation lifecycle
  startGeneration: (gen: PlaygroundGeneration) => void;
  updateGeneration: (gen: PlaygroundGeneration) => void;
  removeGeneration: (id: string) => void;

  // Actions — history
  setHistory: (history: PlaygroundGeneration[]) => void;
  appendToHistory: (gen: PlaygroundGeneration) => void;

  // Actions — templates
  setTemplates: (templates: PlaygroundTemplate[]) => void;
  addTemplate: (template: PlaygroundTemplate) => void;
  updateTemplate: (template: PlaygroundTemplate) => void;
  removeTemplate: (id: string) => void;
  applyTemplate: (template: PlaygroundTemplate) => void;

  // Actions — reset
  resetInput: () => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MODE: PlaygroundMode = 't2i';
const DEFAULT_MODEL_ID = '';
const DEFAULT_PROMPT = '';
const DEFAULT_BATCH_SIZE = 1;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePlaygroundStore = create<PlaygroundState>((set, get) => ({
  // -- Current input --------------------------------------------------------
  mode: DEFAULT_MODE,
  modelId: DEFAULT_MODEL_ID,
  prompt: DEFAULT_PROMPT,
  negativePrompt: '',
  inputMedia: [],
  parameters: {},
  batchSize: DEFAULT_BATCH_SIZE,

  // -- Model preferences ----------------------------------------------------
  modelPreferences: {},

  // -- History ---------------------------------------------------------------
  history: [],

  // -- Templates -------------------------------------------------------------
  templates: [],

  // -- UI --------------------------------------------------------------------
  isGenerating: false,
  activeGenerationIds: [],
  showAdvancedParams: false,
  showTemplateModal: false,
  showHistoryDrawer: false,

  // -- Template favorites ----------------------------------------------------
  favoriteTemplateIds: [],
  toggleTemplateFavorite: (id) => {
    const { favoriteTemplateIds } = get();
    if (favoriteTemplateIds.includes(id)) {
      set({ favoriteTemplateIds: favoriteTemplateIds.filter((fid) => fid !== id) });
    } else {
      set({ favoriteTemplateIds: [...favoriteTemplateIds, id] });
    }
  },
  isTemplateFavorited: (id) => get().favoriteTemplateIds.includes(id),

  // -- Featured output (best-of-batch, one per generation) -------------------
  featuredByGen: loadFeatured(),
  toggleFeatured: (genId, outputId) => {
    const next = { ...get().featuredByGen };
    if (next[genId] === outputId) delete next[genId];
    else next[genId] = outputId;
    saveFeatured(next);
    set({ featuredByGen: next });
  },
  isFeatured: (genId, outputId) => get().featuredByGen[genId] === outputId,

  // -- Generation queue (client-side concurrency gate) -----------------------
  queue: [],
  maxConcurrent: loadConcurrency(),
  enqueueRequest: (req) =>
    set((s) => ({
      queue: [
        ...s.queue,
        { ...req, id: `q${++queueSeq}`, status: 'pending' as const, enqueuedAt: Date.now() },
      ],
    })),
  markDispatching: (id) =>
    set((s) => ({
      queue: s.queue.map((q) => (q.id === id ? { ...q, status: 'dispatching' as const } : q)),
    })),
  removeFromQueue: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),
  setMaxConcurrent: (n) => {
    const clamped = Math.max(1, Math.min(8, Math.round(n)));
    saveConcurrency(clamped);
    set({ maxConcurrent: clamped });
  },

  // =========================================================================
  // Actions
  // =========================================================================

  // -- Input setters ---------------------------------------------------------

  setMode: (mode) => {
    const { modelPreferences } = get();
    const preferredModel = modelPreferences[mode];
    set({
      mode,
      ...(preferredModel !== undefined ? { modelId: preferredModel } : {}),
    });
  },

  setModelId: (modelId) => {
    const { mode, modelPreferences } = get();
    set({
      modelId,
      modelPreferences: { ...modelPreferences, [mode]: modelId },
    });
  },

  setPrompt: (prompt) => set({ prompt }),

  setNegativePrompt: (negativePrompt) => set({ negativePrompt }),

  setInputMedia: (inputMedia) => set({ inputMedia }),

  useResultAsReference: (mediaPath, mediaType, targetMode) => {
    const { modelPreferences } = get();
    const mode: PlaygroundMode =
      targetMode ?? (mediaType === 'video' ? 'v2v' : 'i2i');
    const preferredModel = modelPreferences[mode];
    set({
      mode,
      inputMedia: [mediaPath],
      ...(preferredModel !== undefined ? { modelId: preferredModel } : {}),
    });
  },

  setParameters: (parameters) => set({ parameters }),

  setBatchSize: (batchSize) => set({ batchSize }),

  setShowAdvancedParams: (showAdvancedParams) => set({ showAdvancedParams }),

  setShowTemplateModal: (showTemplateModal) =>
    set(showTemplateModal ? { showTemplateModal, showHistoryDrawer: false } : { showTemplateModal }),

  setShowHistoryDrawer: (showHistoryDrawer) =>
    set(showHistoryDrawer ? { showHistoryDrawer, showTemplateModal: false } : { showHistoryDrawer }),

  // -- Generation lifecycle --------------------------------------------------

  startGeneration: (gen) => {
    const { activeGenerationIds, history } = get();
    set({
      activeGenerationIds: [...activeGenerationIds, gen.id],
      history: [gen, ...history],
      isGenerating: true,
    });
  },

  updateGeneration: (gen) => {
    const { history, activeGenerationIds } = get();
    const updatedHistory = history.map((h) => (h.id === gen.id ? gen : h));
    const isTerminal = gen.status === 'completed' || gen.status === 'failed';
    const updatedActive = isTerminal
      ? activeGenerationIds.filter((id) => id !== gen.id)
      : activeGenerationIds;

    set({
      history: updatedHistory,
      activeGenerationIds: updatedActive,
      isGenerating: updatedActive.length > 0,
    });
  },

  removeGeneration: (id) => {
    const { history, activeGenerationIds } = get();
    const updatedActive = activeGenerationIds.filter((gid) => gid !== id);
    set({
      history: history.filter((h) => h.id !== id),
      activeGenerationIds: updatedActive,
      isGenerating: updatedActive.length > 0,
    });
  },

  // -- History ---------------------------------------------------------------

  setHistory: (history) => set({ history }),

  appendToHistory: (gen) => set((s) => ({ history: [gen, ...s.history] })),

  // -- Templates -------------------------------------------------------------

  setTemplates: (templates) => set({ templates }),

  addTemplate: (template) =>
    set((s) => ({ templates: [...s.templates, template] })),

  updateTemplate: (template) =>
    set((s) => ({
      templates: s.templates.map((t) => (t.id === template.id ? template : t)),
    })),

  removeTemplate: (id) =>
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),

  applyTemplate: (template) => {
    const patch: Partial<PlaygroundState> = {
      prompt: template.prompt,
    };
    if (template.negative_prompt != null) {
      patch.negativePrompt = template.negative_prompt;
    }
    if (template.default_mode != null) {
      patch.mode = template.default_mode;
    }
    if (template.default_model_id != null) {
      patch.modelId = template.default_model_id;
    }
    if (
      template.default_parameters != null &&
      Object.keys(template.default_parameters).length > 0
    ) {
      patch.parameters = template.default_parameters;
    }
    set(patch);
  },

  // -- Reset -----------------------------------------------------------------

  resetInput: () =>
    set({
      prompt: DEFAULT_PROMPT,
      negativePrompt: '',
      inputMedia: [],
      parameters: {},
      batchSize: DEFAULT_BATCH_SIZE,
    }),
}));
