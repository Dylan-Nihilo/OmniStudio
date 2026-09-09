// @vitest-environment happy-dom
import { AxiosError } from "axios";
import { expect, it } from "vitest";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/apiClient";

it("keeps synchronous extraction and creation alive beyond the observed 35 second model latency", async () => {
  const previous = apiClient.defaults.adapter;
  apiClient.defaults.adapter = async config => {
    if (config.timeout && config.timeout <= 35_000) {
      throw new AxiosError("Model response arrived after client timeout", "ECONNABORTED", config);
    }
    return { data: { original_text: "夜间站台", characters: [], scenes: [], props: [] }, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    await expect(api.extractPreview("project", "夜间站台")).resolves.toHaveProperty("characters");
    await expect(api.reparseProject("project", "夜间站台")).resolves.toHaveProperty("originalText", "夜间站台");
    await expect(api.createProject("夜站", "夜间站台")).resolves.toHaveProperty("originalText", "夜间站台");
  } finally {
    apiClient.defaults.adapter = previous;
  }
});
