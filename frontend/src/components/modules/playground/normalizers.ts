import type { PlaygroundGenerationResponse, PlaygroundTemplateResponse } from '@/lib/api';
import type {
  PlaygroundGeneration,
  PlaygroundMode,
  PlaygroundOutput,
  PlaygroundTemplate,
} from './usePlaygroundStore';

const MODES: PlaygroundMode[] = ['t2i', 'i2i', 't2v', 'i2v', 'r2v', 'v2v'];
const STATUSES: PlaygroundGeneration['status'][] = ['pending', 'processing', 'completed', 'failed'];

type AnyRecord = Record<string, any>;

function asRecord(value: unknown): AnyRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyRecord
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeMode(value: unknown): PlaygroundMode {
  return MODES.includes(value as PlaygroundMode) ? value as PlaygroundMode : 't2i';
}

function normalizeStatus(value: unknown): PlaygroundGeneration['status'] {
  return STATUSES.includes(value as PlaygroundGeneration['status'])
    ? value as PlaygroundGeneration['status']
    : 'failed';
}

export function normalizeOutput(value: unknown, index = 0): PlaygroundOutput {
  const raw = asRecord(value);
  const mediaType = raw.media_type === 'video' ? 'video' : 'image';
  return {
    id: asString(raw.id, `output-${index}`),
    media_path: asString(raw.media_path),
    media_type: mediaType,
    ...(typeof raw.thumbnail_path === 'string' ? { thumbnail_path: raw.thumbnail_path } : {}),
    saved_to_library: raw.saved_to_library === true,
  };
}

export function normalizeGeneration(value: PlaygroundGenerationResponse | unknown): PlaygroundGeneration {
  const raw = asRecord(value);
  const outputs = Array.isArray(raw.outputs) ? raw.outputs.map((item, index) => normalizeOutput(item, index)) : [];
  const batchSize = Math.max(1, Math.round(asNumber(raw.batch_size, outputs.length || 1)));
  return {
    id: asString(raw.id, `generation-${Date.now()}`),
    mode: normalizeMode(raw.mode),
    model_id: asString(raw.model_id, 'unknown-model'),
    prompt: asString(raw.prompt),
    ...(typeof raw.negative_prompt === 'string' ? { negative_prompt: raw.negative_prompt } : {}),
    input_media: asStringArray(raw.input_media),
    parameters: asRecord(raw.parameters),
    batch_size: batchSize,
    outputs,
    status: normalizeStatus(raw.status),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
    created_at: asString(raw.created_at, new Date(0).toISOString()),
  };
}

export function normalizeTemplate(value: PlaygroundTemplateResponse | unknown, index = 0): PlaygroundTemplate {
  const raw = asRecord(value);
  return {
    id: asString(raw.id, `template-${index}`),
    name: asString(raw.name, 'Untitled template'),
    category: asString(raw.category, 'general'),
    prompt: asString(raw.prompt),
    ...(typeof raw.negative_prompt === 'string' ? { negative_prompt: raw.negative_prompt } : {}),
    ...(MODES.includes(raw.default_mode as PlaygroundMode) ? { default_mode: raw.default_mode as PlaygroundMode } : {}),
    ...(typeof raw.default_model_id === 'string' ? { default_model_id: raw.default_model_id } : {}),
    default_parameters: asRecord(raw.default_parameters),
    created_at: asString(raw.created_at, new Date(0).toISOString()),
    updated_at: asString(raw.updated_at, asString(raw.created_at, new Date(0).toISOString())),
  };
}
