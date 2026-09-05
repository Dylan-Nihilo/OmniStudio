/** Local UI review session. No real account, credentials or backend writes. */
import http from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { buildNextDevEnv } from "./run-next-dev.mjs";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const covers = [
  "auth/hero-night-signal.png",
  "assets/styles/japanese_anime__modern_cel_anime__rooftop_sunset_v2__landscape.png",
  "assets/styles/japanese_anime__80s_90s_urban_anime__showa_beauty_sports_car__square.png",
  "assets/styles/japanese_anime__warm_hand_drawn_anime__forest_creature_valley_v2__landscape.png",
];
const projects = ["夜航信号", "雨后城市", "远方的回声", "楼梯间的风"].map((title, index) => ({
  id: `ui-preview-${index}`, title, original_text: "少女循着一段陌生的电波，穿过城市，寻找夜航信号的源头。",
  characters: [], scenes: [], props: [], workflow_mode: "r2v", status: "draft",
  created_at: 1788500000 - index * 3600, updated_at: 1788500000 - index * 3600,
  frames: Array.from({ length: 18 }, (_, n) => ({
    id: `shot-${n}`, frame_index: n, description: `镜头 ${n + 1}`,
    rendered_image_url: n < 12 ? covers[index] : null,
  })),
  video_tasks: [],
}));
const user = { id: "ui-preview-user", username: "ui-preview", display_name: "Dylan", email: "preview@example.test", created_at: "2026-09-05T00:00:00Z" };
const workspace = { id: "ui-preview-workspace", name: "演示工作区", slug: "ui-preview", role: "member" };

export function previewHandler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  const reply = (status, data) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(data));
  };
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (!["GET", "HEAD"].includes(request.method)) {
    return reply(403, { detail: "当前为只读 UI 预览，请在正常登录后执行此操作。" });
  }
  if (pathname.startsWith("/files/")) {
    const file = pathname.slice("/files/".length);
    if (!covers.includes(file)) return reply(404, { detail: "Preview asset not found" });
    response.writeHead(200, { "Content-Type": "image/png" });
    return response.end(readFileSync(path.join(frontend, "public", file)));
  }
  const responses = {
    "/auth/setup-status": { initialized: true, setup_allowed: false, setup_token_required: false },
    "/auth/me": { user, workspace, workspaces: [workspace] },
    "/auth/legacy-claim/status": { summary: { projects: 0, series: 0, media: 0, conflicts: 0 }, batch: null },
    "/config/env": { DASHSCOPE_API_KEY: "ui-preview-placeholder" },
    "/projects": projects,
    "/series": [],
    "/library/assets": { characters: [], scenes: [], props: [] },
    "/playground/history": [],
    "/playground/templates": [],
  };
  if (Object.hasOwn(responses, pathname)) return reply(200, responses[pathname]);
  const project = projects.find((item) => pathname === `/projects/${item.id}`);
  if (project) return reply(200, project);
  return reply(404, { detail: "This endpoint is not available in UI preview" });
}

export function runPreview() {
  if (process.env.NODE_ENV === "production") throw new Error("UI preview is available only in local development");
  const server = http.createServer(previewHandler);
  server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  server.listen(3021, "localhost", () => {
    const env = buildNextDevEnv({ ...process.env, NODE_ENV: "development", NEXT_PUBLIC_BACKEND_PORT: "3021", NEXT_DEV_DIST_DIR: ".next-ui-preview" });
    delete env.NEXT_PUBLIC_API_URL;
    mkdirSync(path.join(frontend, env.NEXT_DEV_DIST_DIR), { recursive: true });
    writeFileSync(path.join(frontend, env.NEXT_DEV_DIST_DIR, ".gitignore"), "*\n");
    const child = spawn(process.execPath, [path.join(frontend, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3020"], { cwd: frontend, env, stdio: "inherit" });
    child.on("error", (error) => { console.error(error.message); server.close(); process.exitCode = 1; });
    child.on("exit", (code) => { server.close(); process.exitCode = code ?? 1; });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { child.kill(signal); server.close(); });
    console.log("UI preview (demo data, read-only): http://127.0.0.1:3020/#/workspace");
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runPreview();
