/**
 * Tests for model-adaptive video parameter configs.
 *
 * Covers:
 * - I2V_MODELS 配置完整性
 * - ModelParamSupport 各模型参数正确性
 * - GRID_COLS_CLASS 工具映射
 * - VideoParams 类型实例化
 */
import { describe, it, expect } from 'vitest';
import {
    I2V_MODELS,
    GRID_COLS_CLASS,
    type ModelParamSupport,
} from '@/store/projectStore';
import rawCatalog from '@/generated/modelCatalog.json';

// ── I2V_MODELS 配置完整性 ─────────────────────────────────────────────

describe('I2V_MODELS 配置', () => {
    it('每个模型都包含 params 字段', () => {
        for (const model of I2V_MODELS) {
            expect(model.params).toBeDefined();
            expect(typeof model.params).toBe('object');
        }
    });

    it('每个模型都有唯一 id', () => {
        const ids = I2V_MODELS.map(m => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('每个模型都有 duration 配置', () => {
        for (const model of I2V_MODELS) {
            expect(model.duration).toBeDefined();
            expect(['slider', 'buttons', 'fixed']).toContain(model.duration.type);
        }
    });
});

// ── Wan 2.6 参数 ───────────────────────────────────────────────────────

// wan2.6-i2v is now hidden in the catalog (deprecated in 524f3a1, visible_in:
// []), so it no longer appears in I2V_MODELS. Read its params directly from the
// generated catalog to keep the wan2.6 contract documented and tested.
describe('Wan 2.6 模型参数', () => {
    const p = (rawCatalog as any).models['wan2.6-i2v']?.params as ModelParamSupport;

    it('支持所有 Wan 系列参数', () => {
        expect(p.resolution).toBeDefined();
        expect(p.seed).toBe(true);
        expect(p.negativePrompt).toBe(true);
        expect(p.promptExtend).toBe(true);
        expect(p.shotType).toBe(true);
        expect(p.audio).toBe(true);
    });

    it('resolution 包含 480p/720p/1080p', () => {
        expect(p.resolution!.options).toEqual(['480p', '720p', '1080p']);
        expect(p.resolution!.default).toBe('720p');
    });

    it('不支持 Kling/Vidu 独有参数', () => {
        expect(p.mode).toBeUndefined();
        expect(p.sound).toBeUndefined();
        expect(p.cfgScale).toBeUndefined();
        expect(p.viduAudio).toBeUndefined();
        expect(p.movementAmplitude).toBeUndefined();
    });
});

// ── Wan 2.5 参数 ───────────────────────────────────────────────────────

// wan2.5-i2v-preview is now hidden in the catalog (visible_in: []), so
// it doesn't appear in I2V_MODELS. Read its params directly from the
// generated catalog to keep the wan2.5 contract documented and tested.
describe('Wan 2.5 模型参数', () => {
    const wan25Params = (rawCatalog as any).models['wan2.5-i2v-preview']?.params;
    const p = wan25Params as ModelParamSupport;

    it('支持 resolution, seed, negativePrompt, audio', () => {
        expect(p.resolution).toBeDefined();
        expect(p.seed).toBe(true);
        expect(p.negativePrompt).toBe(true);
        expect(p.audio).toBe(true);
    });

    it('不支持 promptExtend 和 shotType', () => {
        expect(p.promptExtend).toBeUndefined();
        expect(p.shotType).toBeUndefined();
    });
});

// ── Wan 2.2 参数 ───────────────────────────────────────────────────────

describe('Wan 2.2 模型参数', () => {
    // wan2.2-i2v-plus is now hidden in the catalog. Read params directly
    // from the raw catalog so the legacy contract stays documented.
    const wan22Params = (rawCatalog as any).models['wan2.2-i2v-plus']?.params;
    const p = wan22Params as ModelParamSupport;

    it('支持 resolution, seed, negativePrompt', () => {
        expect(p.resolution).toBeDefined();
        expect(p.seed).toBe(true);
        expect(p.negativePrompt).toBe(true);
    });

    it('不支持 promptExtend, shotType, audio', () => {
        expect(p.promptExtend).toBeUndefined();
        expect(p.shotType).toBeUndefined();
        expect(p.audio).toBeUndefined();
    });
});

// ── Kling v3 参数 ──────────────────────────────────────────────────────

describe('Kling v3 模型参数', () => {
    // kling-v3-i2v is retired (the price book covers only Seedance and MiniMax), so it no
    // longer appears in I2V_MODELS. Read its params straight from the generated catalog to
    // keep the Kling contract documented and tested, as the wan blocks above do.
    const p = (rawCatalog as any).models['kling-v3-i2v'].params as ModelParamSupport;

    it('支持 negativePrompt, mode, sound, cfgScale', () => {
        expect(p.negativePrompt).toBe(true);
        expect(p.mode).toBeDefined();
        expect(p.sound).toBe(true);
        expect(p.cfgScale).toBeDefined();
    });

    it('mode 选项为 std/pro，默认 std', () => {
        expect(p.mode!.options).toEqual(['std', 'pro']);
        expect(p.mode!.default).toBe('std');
    });

    it('cfgScale 范围 0-1，步长 0.1', () => {
        expect(p.cfgScale!.min).toBe(0);
        expect(p.cfgScale!.max).toBe(1);
        expect(p.cfgScale!.step).toBe(0.1);
        expect(p.cfgScale!.default).toBe(0.5);
    });

    it('不支持 Wan 独有参数', () => {
        // Phase 2 per-model catalog params list unsupported flags explicitly as
        // `false` instead of omitting them, so assert falsy (false | undefined)
        // for "not supported".
        expect(p.resolution).toBeFalsy();
        expect(p.seed).toBeFalsy();
        expect(p.promptExtend).toBeFalsy();
        expect(p.shotType).toBeFalsy();
        // kling-v3-i2v exposes `sound` (asserted above), not `audio`.
        expect(p.audio).toBeFalsy();
    });

    it('不支持 Vidu 独有参数', () => {
        expect(p.viduAudio).toBeFalsy();
        expect(p.movementAmplitude).toBeFalsy();
    });
});

// ── Vidu Q3 参数 ───────────────────────────────────────────────────────

describe('Vidu Q3 模型参数', () => {
    // Retired alongside Kling, so read params from the generated catalog rather than
    // I2V_MODELS.
    const viduPro = (rawCatalog as any).models['viduq3-pro-i2v'].params as ModelParamSupport;
    const viduTurbo = (rawCatalog as any).models['viduq3-turbo-i2v'].params as ModelParamSupport;

    it('Pro 和 Turbo 使用相同的参数配置', () => {
        expect(viduPro).toEqual(viduTurbo);
    });

    const p = viduPro;

    it('支持 resolution, seed, viduAudio, movementAmplitude', () => {
        expect(p.resolution).toBeDefined();
        expect(p.seed).toBe(true);
        expect(p.viduAudio).toBe(true);
        expect(p.movementAmplitude).toBeDefined();
    });

    it('resolution 包含 540p/720p/1080p', () => {
        expect(p.resolution!.options).toEqual(['540p', '720p', '1080p']);
    });

    it('movementAmplitude 选项为 auto/small/medium/large', () => {
        expect(p.movementAmplitude!.options).toEqual(['auto', 'small', 'medium', 'large']);
        expect(p.movementAmplitude!.default).toBe('auto');
    });

    it('不支持 Kling/Wan 独有参数', () => {
        // Per-model catalog params list unsupported flags explicitly as
        // `false`; assert falsy (false | undefined) for "not supported".
        expect(p.negativePrompt).toBeFalsy();
        expect(p.promptExtend).toBeFalsy();
        expect(p.shotType).toBeFalsy();
        expect(p.audio).toBeFalsy();
        expect(p.mode).toBeFalsy();
        expect(p.sound).toBeFalsy();
        expect(p.cfgScale).toBeFalsy();
    });
});

// ── GRID_COLS_CLASS 映射 ───────────────────────────────────────────────

describe('GRID_COLS_CLASS', () => {
    it('2 列映射为 grid-cols-2', () => {
        expect(GRID_COLS_CLASS[2]).toBe('grid-cols-2');
    });

    it('3 列映射为 grid-cols-3', () => {
        expect(GRID_COLS_CLASS[3]).toBe('grid-cols-3');
    });

    it('4 列映射为 grid-cols-4', () => {
        expect(GRID_COLS_CLASS[4]).toBe('grid-cols-4');
    });

    it('覆盖所有 I2V_MODELS 中实际使用的列数', () => {
        // resolution: 3 cols, mode: 2 cols, movementAmplitude: 4 cols, duration buttons: 2 cols
        const usedCounts = new Set<number>();
        for (const model of I2V_MODELS) {
            const p = model.params;
            if (p.resolution) usedCounts.add(p.resolution.options.length);
            if (p.mode) usedCounts.add(p.mode.options.length);
            if (p.movementAmplitude) usedCounts.add(p.movementAmplitude.options.length);
            if (model.duration.type === 'buttons') {
                usedCounts.add(model.duration.options.length);
            }
        }
        usedCounts.forEach((count) => {
            expect(GRID_COLS_CLASS[count]).toBeDefined();
        });
    });
});

// ── 参数默认值重置逻辑（纯逻辑测试） ──────────────────────────────────

describe('模型切换参数重置逻辑', () => {
    /** 模拟 VideoSidebar 中 updateParam("model", ...) 的重置逻辑 */
    function simulateModelSwitch(targetModelId: string): Record<string, any> {
        const newModelConfig = I2V_MODELS.find(m => m.id === targetModelId);
        const np = newModelConfig?.params ?? {};
        return {
            resolution: np.resolution?.default ?? "720p",
            promptExtend: !!np.promptExtend,
            negativePrompt: "",
            shotType: "single",
            generateAudio: false,
            audioUrl: "",
            mode: np.mode?.default ?? "std",
            sound: false,
            cfgScale: np.cfgScale?.default ?? 0.5,
            viduAudio: true,
            movementAmplitude: np.movementAmplitude?.default ?? "auto",
        };
    }

    // The sidebar can only switch between models in I2V_MODELS, which the catalog now
    // narrows to the two the price book covers.
    it('切换到 Seedance 2.0 → resolution 默认 1080p，无 promptExtend', () => {
        const result = simulateModelSwitch('seedance-2.0-i2v');
        expect(result.resolution).toBe('1080p');
        expect(result.promptExtend).toBe(false);
    });

    it('切换到 MiniMax A → resolution 默认 720P', () => {
        // 1K/2K were the MOMA route's names. minimax-A uses 720P/960P/2K, passed through
        // verbatim as both the price match key and the upstream value — hence the capital P.
        const result = simulateModelSwitch('minimax/minimax-h3');
        expect(result.resolution).toBe('720P');
        expect(result.promptExtend).toBe(false);
    });

    it('切换到已下架模型 → 回落到内置默认值而不是崩溃', () => {
        // A stored project may still name a retired model; the reset must not throw.
        const result = simulateModelSwitch('wan2.7-i2v');
        expect(result.resolution).toBe('720p');
        expect(result.promptExtend).toBe(false);
        expect(result.mode).toBe('std');
    });
});
