/**
 * Tests for EnvConfig dialog/settings pure logic:
 * - provider-mode aware required-field validation
 * - endpoint_overrides state transforms
 * - API response normalization
 * - required-dialog canClose behavior
 */
import { describe, it, expect } from "vitest";

type ProviderMode = "dashscope" | "vendor";
type LlmProvider = "dashscope" | "openai";

interface EnvConfig {
  LLM_PROVIDER: LlmProvider;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;
  OPENAI_MODEL: string;
  DASHSCOPE_API_KEY: string;
  ALIBABA_CLOUD_ACCESS_KEY_ID: string;
  ALIBABA_CLOUD_ACCESS_KEY_SECRET: string;
  OSS_BUCKET_NAME: string;
  OSS_ENDPOINT: string;
  OSS_BASE_PATH: string;
  KLING_PROVIDER_MODE: ProviderMode;
  VIDU_PROVIDER_MODE: ProviderMode;
  PIXVERSE_PROVIDER_MODE: ProviderMode;
  KLING_ACCESS_KEY: string;
  KLING_SECRET_KEY: string;
  VIDU_API_KEY: string;
  endpoint_overrides: Record<string, string>;
  [key: string]: string | Record<string, string>;
}

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
  OSS_BUCKET_NAME: "",
  OSS_ENDPOINT: "",
  OSS_BASE_PATH: "",
  KLING_PROVIDER_MODE: "dashscope",
  VIDU_PROVIDER_MODE: "dashscope",
  PIXVERSE_PROVIDER_MODE: "dashscope",
  KLING_ACCESS_KEY: "",
  KLING_SECRET_KEY: "",
  VIDU_API_KEY: "",
  endpoint_overrides: {},
};

function normalizeProviderMode(mode?: string): ProviderMode {
  return mode === "vendor" ? "vendor" : "dashscope";
}

function normalizeLlmProvider(provider?: string): LlmProvider {
  return provider === "openai" ? "openai" : "dashscope";
}

/** Mirrors validateRequiredFields() after Task 8 */
function validateRequiredFields(config: EnvConfig): boolean {
  const llmKey = config.LLM_PROVIDER === "openai"
    ? config.OPENAI_API_KEY?.trim()
    : config.DASHSCOPE_API_KEY?.trim();
  if (!llmKey) return false;

  if (config.KLING_PROVIDER_MODE === "vendor") {
    const klingAccessKey = config.KLING_ACCESS_KEY?.trim();
    const klingSecretKey = config.KLING_SECRET_KEY?.trim();
    if (!klingAccessKey || !klingSecretKey) return false;
  }

  if (config.VIDU_PROVIDER_MODE === "vendor") {
    const viduApiKey = config.VIDU_API_KEY?.trim();
    if (!viduApiKey) return false;
  }

  return true;
}

/** Mirrors handleChange() state updater */
function applyChange(config: EnvConfig, key: string, value: string): EnvConfig {
  return { ...config, [key]: value };
}

/** Mirrors handleEndpointChange() state updater */
function applyEndpointChange(config: EnvConfig, envKey: string, value: string): EnvConfig {
  return {
    ...config,
    endpoint_overrides: { ...config.endpoint_overrides, [envKey]: value },
  };
}

/** Mirrors loadConfig() normalization in dialog/settings */
function normalizeApiResponse(existing: EnvConfig, data: { [key: string]: unknown }): EnvConfig {
  const base = data as Partial<EnvConfig>;

  const klingMode =
    typeof data.KLING_PROVIDER_MODE === "string" ? data.KLING_PROVIDER_MODE : existing.KLING_PROVIDER_MODE;
  const viduMode =
    typeof data.VIDU_PROVIDER_MODE === "string" ? data.VIDU_PROVIDER_MODE : existing.VIDU_PROVIDER_MODE;
  const pixverseMode =
    typeof data.PIXVERSE_PROVIDER_MODE === "string"
      ? data.PIXVERSE_PROVIDER_MODE
      : existing.PIXVERSE_PROVIDER_MODE;

  const endpointOverrides =
    typeof data.endpoint_overrides === "object" && data.endpoint_overrides !== null
      ? (data.endpoint_overrides as Record<string, string>)
      : existing.endpoint_overrides ?? {};

  return {
    ...existing,
    ...base,
    LLM_PROVIDER: normalizeLlmProvider(typeof data.LLM_PROVIDER === "string" ? data.LLM_PROVIDER : existing.LLM_PROVIDER),
    KLING_PROVIDER_MODE: normalizeProviderMode(klingMode),
    VIDU_PROVIDER_MODE: normalizeProviderMode(viduMode),
    PIXVERSE_PROVIDER_MODE: normalizeProviderMode(pixverseMode),
    endpoint_overrides: endpointOverrides,
  };
}

/** Mirrors required-dialog close gating */
function computeCanClose(isRequired: boolean, config: EnvConfig): boolean {
  return !isRequired || validateRequiredFields(config);
}

describe("ENDPOINT_PROVIDERS registry", () => {
  it("has key, label, placeholder for each provider", () => {
    for (const provider of ENDPOINT_PROVIDERS) {
      expect(provider.key).toBeDefined();
      expect(provider.label).toBeDefined();
      expect(provider.placeholder).toBeDefined();
    }
  });

  it("follows {PROVIDER}_BASE_URL naming convention", () => {
    for (const provider of ENDPOINT_PROVIDERS) {
      expect(provider.key).toMatch(/^[A-Z]+_BASE_URL$/);
    }
  });

  it("has unique keys", () => {
    const keys = ENDPOINT_PROVIDERS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("contains the supported endpoint providers", () => {
    expect(ENDPOINT_PROVIDERS).toHaveLength(4);
    const labels = ENDPOINT_PROVIDERS.map((p) => p.label);
    expect(labels).toEqual(expect.arrayContaining(["DashScope", "Kling", "Vidu", "MuleRouter"]));
  });
});

describe("OpenAI-compatible LLM configuration", () => {
  it("switches validation to the OpenAI-compatible API key", () => {
    expect(validateRequiredFields({ ...DEFAULT_CONFIG, LLM_PROVIDER: "openai" })).toBe(false);
    expect(validateRequiredFields({
      ...DEFAULT_CONFIG,
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
    })).toBe(true);
  });

  it("normalizes unknown LLM providers back to DashScope", () => {
    const result = normalizeApiResponse(DEFAULT_CONFIG, { LLM_PROVIDER: "unknown" });
    expect(result.LLM_PROVIDER).toBe("dashscope");
  });

  it("preserves OpenAI-compatible fields returned by the API", () => {
    const result = normalizeApiResponse(DEFAULT_CONFIG, {
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "••••••••last",
      OPENAI_BASE_URL: "https://api.deepseek.com/v1",
      OPENAI_MODEL: "deepseek-chat",
    });
    expect(result.LLM_PROVIDER).toBe("openai");
    expect(result.OPENAI_API_KEY).toBe("••••••••last");
    expect(result.OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(result.OPENAI_MODEL).toBe("deepseek-chat");
  });
});

describe("validateRequiredFields", () => {
  it("returns false when the active LLM key is missing", () => {
    expect(validateRequiredFields(DEFAULT_CONFIG)).toBe(false);
  });

  it("returns true when only DashScope key is present (default provider modes)", () => {
    const valid = { ...DEFAULT_CONFIG, DASHSCOPE_API_KEY: "sk-test" };
    expect(validateRequiredFields(valid)).toBe(true);
  });

  it("does not require OSS or Alibaba credentials", () => {
    const valid = {
      ...DEFAULT_CONFIG,
      DASHSCOPE_API_KEY: "sk-test",
      ALIBABA_CLOUD_ACCESS_KEY_ID: "",
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: "",
      OSS_BUCKET_NAME: "",
      OSS_ENDPOINT: "",
    };
    expect(validateRequiredFields(valid)).toBe(true);
  });

  it("requires Kling vendor credentials when KLING_PROVIDER_MODE=vendor", () => {
    const invalid = {
      ...DEFAULT_CONFIG,
      DASHSCOPE_API_KEY: "sk-test",
      KLING_PROVIDER_MODE: "vendor" as const,
      KLING_ACCESS_KEY: "",
      KLING_SECRET_KEY: "",
    };
    expect(validateRequiredFields(invalid)).toBe(false);

    const valid = {
      ...invalid,
      KLING_ACCESS_KEY: "kling-ak",
      KLING_SECRET_KEY: "kling-sk",
    };
    expect(validateRequiredFields(valid)).toBe(true);
  });

  it("requires Vidu API key when VIDU_PROVIDER_MODE=vendor", () => {
    const invalid = {
      ...DEFAULT_CONFIG,
      DASHSCOPE_API_KEY: "sk-test",
      VIDU_PROVIDER_MODE: "vendor" as const,
      VIDU_API_KEY: "",
    };
    expect(validateRequiredFields(invalid)).toBe(false);

    const valid = {
      ...invalid,
      VIDU_API_KEY: "vidu-key",
    };
    expect(validateRequiredFields(valid)).toBe(true);
  });

  it("trims whitespace before validation", () => {
    const invalid = {
      ...DEFAULT_CONFIG,
      DASHSCOPE_API_KEY: "   ",
    };
    expect(validateRequiredFields(invalid)).toBe(false);

    const valid = {
      ...DEFAULT_CONFIG,
      DASHSCOPE_API_KEY: "  sk-test  ",
      KLING_PROVIDER_MODE: "vendor" as const,
      KLING_ACCESS_KEY: " kling-ak ",
      KLING_SECRET_KEY: " kling-sk ",
      VIDU_PROVIDER_MODE: "vendor" as const,
      VIDU_API_KEY: " vidu-key ",
    };
    expect(validateRequiredFields(valid)).toBe(true);
  });
});

describe("applyChange (handleChange logic)", () => {
  it("updates a single field immutably", () => {
    const updated = applyChange(DEFAULT_CONFIG, "DASHSCOPE_API_KEY", "sk-new");
    expect(updated.DASHSCOPE_API_KEY).toBe("sk-new");
    expect(DEFAULT_CONFIG.DASHSCOPE_API_KEY).toBe("");
  });

  it("preserves provider mode fields when changing key values", () => {
    const base = { ...DEFAULT_CONFIG, KLING_PROVIDER_MODE: "vendor" as const };
    const updated = applyChange(base, "DASHSCOPE_API_KEY", "sk-new");
    expect(updated.KLING_PROVIDER_MODE).toBe("vendor");
  });
});

describe("applyEndpointChange (handleEndpointChange logic)", () => {
  it("adds and updates endpoint overrides immutably", () => {
    const added = applyEndpointChange(DEFAULT_CONFIG, "DASHSCOPE_BASE_URL", "https://intl.example.com");
    expect(added.endpoint_overrides.DASHSCOPE_BASE_URL).toBe("https://intl.example.com");

    const updated = applyEndpointChange(added, "DASHSCOPE_BASE_URL", "https://new.example.com");
    expect(updated.endpoint_overrides.DASHSCOPE_BASE_URL).toBe("https://new.example.com");
    expect(added.endpoint_overrides.DASHSCOPE_BASE_URL).toBe("https://intl.example.com");
  });

  it("preserves other overrides when changing one", () => {
    const base = {
      ...DEFAULT_CONFIG,
      endpoint_overrides: {
        DASHSCOPE_BASE_URL: "https://ds.example.com",
        KLING_BASE_URL: "https://kling.example.com",
      },
    };
    const updated = applyEndpointChange(base, "VIDU_BASE_URL", "https://vidu.example.com");
    expect(updated.endpoint_overrides.KLING_BASE_URL).toBe("https://kling.example.com");
    expect(updated.endpoint_overrides.VIDU_BASE_URL).toBe("https://vidu.example.com");
  });
});

describe("normalizeApiResponse", () => {
  it("preserves provider-mode fields from API response", () => {
    const apiData = {
      DASHSCOPE_API_KEY: "sk-from-api",
      KLING_PROVIDER_MODE: "vendor",
      VIDU_PROVIDER_MODE: "vendor",
      PIXVERSE_PROVIDER_MODE: "dashscope",
      endpoint_overrides: { KLING_BASE_URL: "https://custom-kling.example.com" },
    };
    const result = normalizeApiResponse(DEFAULT_CONFIG, apiData);
    expect(result.KLING_PROVIDER_MODE).toBe("vendor");
    expect(result.VIDU_PROVIDER_MODE).toBe("vendor");
    expect(result.endpoint_overrides).toEqual({ KLING_BASE_URL: "https://custom-kling.example.com" });
  });

  it("falls back missing or invalid provider modes to dashscope", () => {
    const result = normalizeApiResponse(DEFAULT_CONFIG, {
      KLING_PROVIDER_MODE: "unexpected-value",
      endpoint_overrides: {},
    });
    expect(result.KLING_PROVIDER_MODE).toBe("dashscope");
    expect(result.VIDU_PROVIDER_MODE).toBe("dashscope");
    expect(result.PIXVERSE_PROVIDER_MODE).toBe("dashscope");
  });

  it("preserves existing endpoint overrides when API omits endpoint_overrides", () => {
    const existing = {
      ...DEFAULT_CONFIG,
      endpoint_overrides: { DASHSCOPE_BASE_URL: "https://existing.example.com" },
    };
    const result = normalizeApiResponse(existing, { DASHSCOPE_API_KEY: "sk-updated" });
    expect(result.endpoint_overrides).toEqual({ DASHSCOPE_BASE_URL: "https://existing.example.com" });
  });
});

describe("computeCanClose", () => {
  it("returns true when dialog is not required", () => {
    expect(computeCanClose(false, DEFAULT_CONFIG)).toBe(true);
  });

  it("blocks closing required dialog until DashScope key is set", () => {
    expect(computeCanClose(true, DEFAULT_CONFIG)).toBe(false);
    const valid = { ...DEFAULT_CONFIG, DASHSCOPE_API_KEY: "sk-test" };
    expect(computeCanClose(true, valid)).toBe(true);
  });

  it("blocks closing required dialog in vendor mode when vendor keys are missing", () => {
    const invalid = {
      ...DEFAULT_CONFIG,
      DASHSCOPE_API_KEY: "sk-test",
      KLING_PROVIDER_MODE: "vendor" as const,
    };
    expect(computeCanClose(true, invalid)).toBe(false);
  });

  it("allows the required dialog to close with an OpenAI-compatible key", () => {
    const openAiConfig = {
      ...DEFAULT_CONFIG,
      LLM_PROVIDER: "openai" as const,
      OPENAI_API_KEY: "",
    };
    expect(computeCanClose(true, openAiConfig)).toBe(false);
    expect(computeCanClose(true, { ...openAiConfig, OPENAI_API_KEY: "sk-test" })).toBe(true);
  });
});
