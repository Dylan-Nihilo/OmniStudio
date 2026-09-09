import { test, expect } from "@playwright/test";

const baseURL = process.env.OMNI_STUDIO_ACCEPTANCE_URL || "http://localhost:3008";

test.describe("main production chain", () => {
  test("clicks workspace, source, script, cast, shot, tasks and export landmarks", async ({ page }) => {
    const responses: string[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api-proxy/")) responses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    });

    await page.goto(`${baseURL}/#/workspace`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-app-sidebar]")).toBeVisible();
    await expect(page.getByRole("heading", { name: /工作区|Workspace/ })).toBeVisible();

    await page.getByRole("link", { name: /来源资料|sources/i }).click();
    await expect(page.getByRole("heading", { name: /来源资料|Source/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /零点信号原始资料/ })).toBeVisible();

    await page.getByRole("link", { name: /工作区|overview/i }).click();
    await page.getByText("零点信号", { exact: true }).first().click();
    for (const label of [/脚本|Script/i, /本集素材|Cast|Assets/i, /分镜|Storyboard/i]) {
      await expect(page.getByRole("row", { name: label })).toBeVisible();
      await page.getByRole("row", { name: label }).click();
    }

    await page.getByRole("button", { name: /任务中心|Tasks/i }).click();
    await expect(page.getByRole("heading", { name: /任务中心|Tasks/i })).toBeVisible();

    await page.getByRole("button", { name: /工作区|Workspace/i }).first().click();
    await page.getByText("零点信号", { exact: true }).first().click();
    await expect(page.getByRole("row", { name: /合成|导出|Assembly|Export/i })).toBeVisible();
    await page.getByRole("row", { name: /合成|导出|Assembly|Export/i }).click();
    await expect(page.getByText(/合成|导出|Assembly|Export/i).first()).toBeVisible();
    expect(responses.some((entry) => entry.includes("/projects"))).toBe(true);
  });
});
