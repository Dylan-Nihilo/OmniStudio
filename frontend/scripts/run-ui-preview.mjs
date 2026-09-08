/** Local UI review session. Edits stay in memory; no real account, credentials or backend writes. */
import http from "node:http";
import { randomUUID } from "node:crypto";
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

const series = [{ id: "ui-preview-series", title: "夜航信号", description: projects[0].original_text,
  workflow_mode: "r2v", content_mode: "scripted", characters: [], scenes: [], props: [], episode_ids: projects.slice(0, 2).map(p => p.id) }];
projects.slice(0, 2).forEach((project, index) => Object.assign(project, { series_id: series[0].id, episode_number: index + 1 }));
const documents = new Map();
const library = { characters: [], scenes: [], props: [] };
const libraryTypes = { character: "characters", scene: "scenes", prop: "props" };
const libraryUploads = new Map();
["玛拉 / 主形象定稿", "城市守夜人", "信号塔楼间", "雨后城市", "接收器 / 剧情道具", "夜航指针"].forEach((name, index) => {
  const type = ["characters", "scenes", "props"][Math.floor(index / 2)];
  const variants = [{ id: `preview-variant-${index}`, url: covers[index % covers.length], created_at: 1788500000 - index * 3600 }];
  library[type].push({ id: `preview-library-${index}`, name, description: "夜航信号", starred: index === 0, locked: false,
    image_url: variants[0].url, ...(type === "characters" ? { reference_sheet: { selected_image_id: variants[0].id, image_variants: variants } } : { image_asset: { selected_id: variants[0].id, variants } }) });
});


const settingsConfig = {
  LLM_PROVIDER: "dashscope", DASHSCOPE_API_KEY: "sk-••••••••demo", OPENAI_API_KEY: "", OPENAI_BASE_URL: "https://api.openai.com/v1", OPENAI_MODEL: "gpt-4o",
  KLING_PROVIDER_MODE: "dashscope", VIDU_PROVIDER_MODE: "dashscope", KLING_ACCESS_KEY: "", KLING_SECRET_KEY: "", VIDU_API_KEY: "", MULEROUTER_API_KEY: "",
  OSS_ENABLE: false, ALIBABA_CLOUD_ACCESS_KEY_ID: "", ALIBABA_CLOUD_ACCESS_KEY_SECRET: "", OSS_BUCKET_NAME: "", OSS_ENDPOINT: "", OSS_BASE_PATH: "", endpoint_overrides: {},
};

// Exposed only to the local launcher so a preview restart can retain review edits.
export const previewState = { projects, series, documents, library, libraryUploads, settingsConfig };

function replaceLibraryImage(asset, type, imageUrl) {
  asset.image_url = imageUrl;
  const character = type === "character";
  const unit = character ? (asset.reference_sheet ||= { image_variants: [], selected_image_id: null }) : (asset.image_asset ||= { variants: [], selected_id: null });
  const variants = character ? unit.image_variants : unit.variants;
  let variant = variants.find(item => item.url === imageUrl);
  if (!variant) {
    variant = { id: `preview-variant-${randomUUID()}`, url: imageUrl, created_at: Date.now() / 1000, source: "uploaded", is_uploaded_source: true };
    variants.push(variant);
  }
  if (character) { unit.selected_image_id = variant.id; asset.avatar_url = imageUrl; }
  else unit.selected_id = variant.id;
}

export async function previewHandler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  const reply = (status, data) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(data));
  };
  const pathname = new URL(request.url, "http://localhost").pathname;
  const method = request.method;
  const reading = ["GET", "HEAD"].includes(method);
  let body = {};
  if (!reading) {
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 11 * 1024 * 1024) return reply(413, { detail: "Preview request is too large" });
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (pathname === "/library/assets/upload" && method === "POST") {
        const form = await new Request("http://localhost/library/assets/upload", { method: "POST", headers: { "Content-Type": request.headers["content-type"] || "" }, body: bytes }).formData();
        const file = form.get("file");
        if (!file || typeof file === "string" || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(file.type) || file.size > 10 * 1024 * 1024) return reply(422, { detail: "Please upload an image up to 10 MB." });
        const image_url = `library-preview/${randomUUID()}`;
        libraryUploads.set(image_url, { bytes: Buffer.from(await file.arrayBuffer()), type: file.type });
        return reply(200, { image_url });
      }
      const raw = bytes.toString();
      body = raw ? JSON.parse(raw) : {};
      if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
    } catch { return reply(400, { detail: "Expected a JSON object" }); }
  }
  const invalid = () => reply(422, { detail: "请检查标题、文本或系列信息。" });
  const missing = () => reply(404, { detail: "Preview item not found" });
  const stamp = () => Date.now() / 1000;
  const projectMatch = pathname.match(/^\/projects\/([^/]+)(?:\/(.*))?$/);
  const project = projectMatch && projects.find(p => p.id === projectMatch[1]);
  const seriesMatch = pathname.match(/^\/series\/([^/]+)(?:\/(.*))?$/);
  const collection = seriesMatch && series.find(s => s.id === seriesMatch[1]);
  if (projectMatch && !project || seriesMatch && !collection) return missing();
  if (pathname === "/library/assets" && method === "POST") {
    const type = libraryTypes[body.asset_type];
    if (!type || typeof body.name !== "string" || !body.name.trim() || ["description", "image_url"].some(key => body[key] != null && typeof body[key] !== "string")) return invalid();
    const asset = { id: `preview-library-${randomUUID()}`, name: body.name.trim(), description: body.description || "", image_url: body.image_url || "", starred: false, locked: false };
    if (body.asset_type === "character" && body.image_url) replaceLibraryImage(asset, "character", body.image_url);
    library[type].push(asset);
    return reply(200, asset);
  }
  const libraryMatch = pathname.match(/^\/library\/assets\/(character|scene|prop)\/([^/]+)$/);
  if (libraryMatch && !reading) {
    const items = library[libraryTypes[libraryMatch[1]]];
    const asset = items.find(item => item.id === libraryMatch[2]);
    if (!asset) return missing();
    if (method === "PUT" || method === "PATCH") {
      if (Object.keys(body).some(key => !["starred", "name", "description", "image_url"].includes(key))) return reply(501, { detail: "Unsupported library preview edit" });
      if (body.starred != null && typeof body.starred !== "boolean" || ["name", "description", "image_url"].some(key => body[key] != null && typeof body[key] !== "string")) return invalid();
      Object.assign(asset, body);
      if (body.image_url) replaceLibraryImage(asset, libraryMatch[1], body.image_url);
      return reply(200, asset);
    }
    if (method === "DELETE") { items.splice(items.indexOf(asset), 1); return reply(200, { success: true }); }
  }
  if (pathname === "/projects" && method === "POST") {
    if (typeof body.title !== "string" || !body.title.trim() || typeof body.text !== "string" ||
        !["r2v", "i2v_legacy"].includes(body.workflow_mode) || body.series_id && !series.some(s => s.id === body.series_id)) return invalid();
    const created = { id: `ui-preview-${randomUUID()}`, title: body.title.trim(), original_text: body.text,
      workflow_mode: body.workflow_mode, characters: [], scenes: [], props: [], frames: [], video_tasks: [],
      created_at: stamp(), updated_at: stamp() };
    if (body.series_id) {
      const parent = series.find(s => s.id === body.series_id);
      Object.assign(created, { series_id: parent.id, episode_number: Math.max(0, ...projects.filter(p => p.series_id === parent.id).map(p => p.episode_number || 0)) + 1 });
      parent.episode_ids.push(created.id);
    }
    projects.push(created);
    return reply(200, created);
  }
  if (project && !projectMatch[2] && method === "DELETE") {
    projects.splice(projects.indexOf(project), 1);
    series.forEach(s => { s.episode_ids = s.episode_ids.filter(id => id !== project.id); });
    documents.delete(project.id);
    return reply(200, { success: true });
  }
  if (project && projectMatch[2]?.startsWith("frames") && !reading) {
    const route = projectMatch[2];
    const match = route.match(/^frames\/([^/]+)(?:\/(workbench))?$/);
    const frameId = route === "frames/update" || route === "frames/copy" ? body.frame_id : match?.[1];
    const frame = project.frames.find(item => item.id === frameId);
    const saveFrames = () => {
      project.frames.forEach((item, index) => { item.frame_index = index; });
      project.updated_at = Math.max(stamp(), project.updated_at + 0.001);
      return reply(200, project);
    };
    if (route === "frames" && method === "POST") {
      if (typeof body.action_description !== "string" || typeof body.scene_id !== "string" ||
          body.insert_at != null && (!Number.isInteger(body.insert_at) || body.insert_at < 0 || body.insert_at > project.frames.length)) return invalid();
      const created = { id: `frame-${randomUUID()}`, action_description: body.action_description, scene_id: body.scene_id };
      project.frames.splice(body.insert_at ?? project.frames.length, 0, created);
      return saveFrames();
    }
    if (route === "frames/reorder" && method === "PUT") {
      if (!Array.isArray(body.frame_ids) || body.frame_ids.length !== project.frames.length ||
          new Set(body.frame_ids).size !== project.frames.length || body.frame_ids.some(id => !project.frames.some(item => item.id === id))) return invalid();
      project.frames = body.frame_ids.map(id => project.frames.find(item => item.id === id));
      return saveFrames();
    }
    if (["frames/copy", "frames/update"].includes(route) || match && (method === "DELETE" || match[2] === "workbench")) {
      if (!frame) return missing();
      if (route === "frames/copy" && method === "POST") {
        if (body.insert_at != null && (!Number.isInteger(body.insert_at) || body.insert_at < 0 || body.insert_at > project.frames.length)) return invalid();
        const copy = { ...frame, id: `frame-${randomUUID()}`, selected_video_id: null, final_take_id: null, t2i_image_urls: [] };
        project.frames.splice(body.insert_at ?? project.frames.indexOf(frame) + 1, 0, copy);
        return saveFrames();
      }
      if (route === "frames/update" && method === "POST") {
        const textFields = ["image_prompt", "action_description", "visual_description", "dialogue", "camera_angle", "scene_id", "shot_size", "camera_movement_description", "transition_hint"];
        if (textFields.some(key => body[key] != null && typeof body[key] !== "string") ||
            body.duration != null && (!Number.isFinite(body.duration) || body.duration <= 0) ||
            body.character_ids != null && (!Array.isArray(body.character_ids) || body.character_ids.some(id => typeof id !== "string"))) return invalid();
        for (const key of [...textFields, "duration", "character_ids"]) if (body[key] != null) frame[key] = body[key];
        return saveFrames();
      }
      if (match?.[2] === "workbench" && method === "PATCH") {
        if (body.workbench_tab_mode != null && !["direct_r2v", "t2i_i2v"].includes(body.workbench_tab_mode) ||
            body.workbench_generate_count != null && (!Number.isInteger(body.workbench_generate_count) || body.workbench_generate_count < 1 || body.workbench_generate_count > 6) ||
            body.t2i_image_urls != null && (!Array.isArray(body.t2i_image_urls) || body.t2i_image_urls.some(url => typeof url !== "string")) ||
            body.t2i_selected_index != null && (!Number.isInteger(body.t2i_selected_index) || body.t2i_selected_index < 0)) return invalid();
        for (const key of ["workbench_tab_mode", "workbench_generate_count", "t2i_image_urls", "t2i_selected_index"]) if (body[key] != null) frame[key] = body[key];
        return saveFrames();
      }
      if (!match?.[2] && method === "DELETE") {
        project.frames.splice(project.frames.indexOf(frame), 1);
        return saveFrames();
      }
    }
  }
  if (projectMatch?.[2] === "edit-lease" && ["POST", "PATCH", "DELETE"].includes(method)) {
    if (typeof body.client_instance_id !== "string" || !body.client_instance_id) return invalid();
    // ponytail: demo leases allow both comparison tabs; real collaboration uses the backend lease service.
    return reply(200, { script_id: project.id, holder_user_id: user.id, holder_display_name: user.display_name,
      client_instance_id: body.client_instance_id, expires_at: stamp() + 90, revision: String(project.updated_at), token: "ui-preview-only" });
  }
  if (projectMatch?.[2] === "text" && method === "PUT") {
    if (typeof body.text !== "string" || typeof body.expected_revision !== "string" ||
        typeof body.client_instance_id !== "string" || !body.client_instance_id) return invalid();
    const revision = String(project.updated_at);
    if (request.headers["x-edit-lease"] !== "ui-preview-only") return reply(423, {
      error: { code: "EDIT_LEASE_INVALID", message: "编辑权限已失效" }, current_revision: revision,
    });
    if (body.expected_revision !== revision) return reply(409, {
      error: { code: "EDIT_REVISION_CONFLICT", message: "内容已被其他编辑更新" }, current_revision: revision,
    });
    project.original_text = body.text;
    project.updated_at = Math.max(stamp(), project.updated_at + 0.001);
    return reply(200, { ...project, _revision: String(project.updated_at) });
  }
  if (projectMatch?.[2] === "document" && (reading || method === "POST")) {
    if (method === "POST") {
      if (body.content?.type !== "doc" || !Array.isArray(body.content.content)) return invalid();
      documents.set(project.id, body.content);
      project.updated_at = stamp();
    }
    return reply(200, { project_id: project.id, updated_at: new Date(project.updated_at * 1000).toISOString(),
      content: documents.get(project.id) || { type: "doc", content: [{ type: "paragraph", content: project.original_text ? [{ type: "text", text: project.original_text }] : [] }] } });
  }
  if (projectMatch?.[2] === "document/snapshots" && reading) return reply(200, []);
  if (projectMatch?.[2] === "previous_episode" && reading) {
    const parent = series.find(item => item.id === project.series_id);
    const index = parent?.episode_ids.indexOf(project.id) ?? -1;
    const previous = index > 0 ? projects.find(item => item.id === parent.episode_ids[index - 1]) : null;
    return reply(200, { has_previous: !!previous?.original_text?.trim(), previous_episode_id: previous?.id ?? null,
      previous_episode_title: previous?.title ?? null, raw_snippet: previous?.original_text?.slice(-800) ?? "",
      ai_summary: null, ai_summary_stale: false });
  }
  if (projectMatch?.[2] === "next_hook" && reading) return reply(200, { has_text: !!project.original_text?.trim(), hook: null, stale: false });
  if (pathname === "/series" && method === "POST") {
    if (typeof body.title !== "string" || !body.title.trim() || body.description != null && typeof body.description !== "string") return invalid();
    const created = { id: `ui-preview-${randomUUID()}`, title: body.title.trim(), description: body.description || "", workflow_mode: body.workflow_mode || "r2v", content_mode: body.content_mode || "scripted", characters: [], scenes: [], props: [], episode_ids: [], created_at: stamp(), updated_at: stamp() };
    series.push(created);
    return reply(200, created);
  }
  if (collection) {
    const subpath = seriesMatch[2];
    if (!subpath && reading) return reply(200, collection);
    if (!subpath && method === "PUT") {
      if (body.title != null && (typeof body.title !== "string" || !body.title.trim()) || body.description != null && typeof body.description !== "string") return invalid();
      for (const key of ["title", "description"]) if (body[key] != null) collection[key] = body[key].trim();
      collection.updated_at = stamp();
      return reply(200, collection);
    }
    if (subpath === "episodes" && reading) return reply(200, projects.filter(p => p.series_id === collection.id));
    if (subpath === "episodes" && method === "POST") {
      const episode = projects.find(p => p.id === body.script_id);
      if (!episode || !Number.isInteger(body.episode_number) || body.episode_number < 1) return invalid();
      series.forEach(s => { s.episode_ids = s.episode_ids.filter(id => id !== episode.id); });
      Object.assign(episode, { series_id: collection.id, episode_number: body.episode_number });
      collection.episode_ids.push(episode.id);
      return reply(200, collection);
    }
    if (subpath === "assets" && reading) return reply(200, { characters: collection.characters, scenes: collection.scenes, props: collection.props });
  }
  const entity = project || collection;
  const settings = projectMatch?.[2] || seriesMatch?.[2];
  if (entity && ["model_settings", "prompt_config"].includes(settings) && (reading || ["POST", "PUT"].includes(method))) {
    if (!reading) {
      if (Object.values(body).some(value => typeof value !== "string")) return invalid();
      entity[settings] = { ...entity[settings], ...body };
    }
    return reply(200, settings === "model_settings" && project && !reading ? project : entity[settings] || {});
  }
  if (pathname === "/config/env") {
    if (reading) return reply(200, settingsConfig);
    if (method === "POST") {
      const invalidValue = Object.entries(body).some(([key, value]) => {
        if (!Object.hasOwn(settingsConfig, key)) return true;
        if (key === "endpoint_overrides") return !value || typeof value !== "object" || Array.isArray(value) || Object.entries(value).some(([endpoint, url]) => !["DASHSCOPE_BASE_URL", "KLING_BASE_URL", "VIDU_BASE_URL", "MULEROUTER_BASE_URL"].includes(endpoint) || typeof url !== "string");
        if (key === "OSS_ENABLE") return typeof value !== "boolean";
        if (typeof value !== "string") return true;
        if (key === "LLM_PROVIDER") return !["dashscope", "openai"].includes(value);
        if (key.endsWith("_PROVIDER_MODE")) return !["dashscope", "vendor"].includes(value);
        return false;
      });
      if (invalidValue) return invalid();
      for (const [key, value] of Object.entries(body)) {
        if (key === "endpoint_overrides") Object.assign(settingsConfig.endpoint_overrides, value);
        else if (/(?:_KEY|_SECRET|_KEY_ID)$/.test(key) && value) {
          if (!value.includes("•")) settingsConfig[key] = `••••••••${value.slice(-4)}`;
        } else settingsConfig[key] = value;
      }
      return reply(200, { status: "success" });
    }
  }
  if (!reading) return reply(501, { detail: "此操作尚未接入本地演示。请在真实工作区执行；演示编辑仅保留到预览服务重启。" });
  if (pathname.startsWith("/files/")) {
    const file = pathname.slice("/files/".length);
    const uploaded = libraryUploads.get(file);
    if (uploaded) { response.writeHead(200, { "Content-Type": uploaded.type }); return response.end(uploaded.bytes); }
    if (!covers.includes(file)) return reply(404, { detail: "Preview asset not found" });
    response.writeHead(200, { "Content-Type": "image/png" });
    return response.end(readFileSync(path.join(frontend, "public", file)));
  }
  const responses = {
    "/auth/setup-status": { initialized: true, setup_allowed: false, setup_token_required: false },
    "/auth/me": { user, workspace, workspaces: [workspace] },
    "/auth/legacy-claim/status": { summary: { projects: 0, series: 0, media: 0, conflicts: 0 }, batch: null },
    "/health": { ok: true, time: Date.now() / 1000, log_file: "", log_dir: "", studio_projects: projects.length },
    "/system/check": { status: "preview", dependencies: {} },
    "/prompt_defaults": {},
    "/projects": projects,
    "/series": series,
    "/library/assets": library,
    "/playground/history": [],
    "/playground/templates": [],
  };
  if (Object.hasOwn(responses, pathname)) return reply(200, responses[pathname]);
  if (project && !projectMatch[2]) return reply(200, project);
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
    console.log("UI preview (demo data, in-memory edits): http://127.0.0.1:3020/#/workspace");
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runPreview();
