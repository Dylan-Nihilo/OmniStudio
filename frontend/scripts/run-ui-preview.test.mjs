import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { previewHandler, runPreview } from "./run-ui-preview.mjs";

test("preview serves a demo identity, rejects writes and unknown assets, and cannot start in production", async () => {
  const server = http.createServer(previewHandler).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const me = await (await fetch(base + "/auth/me")).json();
    assert.equal(me.workspace.id, "ui-preview-workspace");
    const projects = await (await fetch(base + "/projects")).json();
    assert.equal(projects.length, 4);
    assert.equal((await fetch(base + "/files/" + projects[0].frames[0].rendered_image_url)).status, 200);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal((await fetch(base + "/projects", { method })).status, 403);
    }
    assert.equal((await fetch(base + "/files/.env")).status, 404);
    assert.equal((await fetch(base + "/unknown")).status, 404);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try { assert.throws(runPreview, /local development/); }
    finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
