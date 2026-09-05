import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { previewHandler, runPreview } from "./run-ui-preview.mjs";

test("preview supports isolated project/series/document edits and rejects unsupported operations", async () => {
  const server = http.createServer(previewHandler).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const me = await (await fetch(base + "/auth/me")).json();
    assert.equal(me.workspace.id, "ui-preview-workspace");
    const projects = await (await fetch(base + "/projects")).json();
    assert.equal(projects.length, 4);
    assert.equal((await fetch(base + "/files/" + projects[0].frames[0].rendered_image_url)).status, 200);
    const request = (url, method, body) => fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal((await request("/projects", "POST", { title: "" })).status, 422);
    assert.equal((await request("/projects", "POST", [])).status, 400);
    const parent = await (await request("/series", "POST", { title: "Demo series" })).json();
    const created = await (await request("/projects", "POST", { title: "Demo episode", text: "Opening scene", workflow_mode: "r2v", series_id: parent.id })).json();
    assert.equal(created.series_id, parent.id);
    assert.equal(created.episode_number, 1);
    assert.deepEqual((await (await fetch(base + `/series/${parent.id}/episodes`)).json()).map(p => p.id), [created.id]);
    const lease = await request(`/projects/${created.id}/edit-lease`, "POST", { client_instance_id: "test-tab" });
    assert.equal(lease.status, 200);
    assert.equal((await lease.json()).token, "ui-preview-only");
    const document = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Edited draft" }] }] };
    assert.equal((await request(`/projects/${created.id}/document`, "POST", { content: document })).status, 200);
    assert.deepEqual((await (await fetch(base + `/projects/${created.id}/document`)).json()).content, document);
    assert.equal((await request(`/projects/${created.id}/document`, "POST", { content: null })).status, 422);
    assert.equal((await request(`/projects/${created.id}/generate_assets`, "POST", {})).status, 501);
    assert.equal((await request("/auth/login", "POST", {})).status, 501);
    assert.equal((await request(`/projects/${created.id}`, "DELETE")).status, 200);
    assert.equal((await fetch(base + `/projects/${created.id}`)).status, 404);
    assert.deepEqual(await (await fetch(base + `/series/${parent.id}/episodes`)).json(), []);
    assert.equal((await fetch(base + "/files/.env")).status, 404);
    assert.equal((await fetch(base + "/unknown")).status, 404);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try { assert.throws(runPreview, /local development/); }
    finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
