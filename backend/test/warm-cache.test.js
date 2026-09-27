import test from "node:test";
import assert from "node:assert/strict";

import { createGateway } from "../src/gateway.js";

function createFixtureProvider() {
  return {
    async planRoute() { return { protocol_version: 1, routes: [] }; },
    async planRouteOptions() { return { protocol_version: 1, routes: [] }; },
    async searchPlaces() { return { protocol_version: 1, query: "", places: [] }; },
  };
}

function createFakeMapProvider() {
  const calls = [];
  return {
    calls,
    async initialize() {},
    close() {},
    status() { return { enabled: true, mode: "fixed", source_revision: null, cache: { tiles: calls.length } }; },
    async getTile(z, x, y) {
      calls.push({ z, x, y });
      return { protocol_version: 1, tile: { z, x, y }, roads: [], buildings: [],
        source: { provider: "fake", licence: "ODbL-1.0",
          attribution_url: "https://www.openstreetmap.org/copyright",
          source_revision: "1", retrieved_at: new Date().toISOString() } };
    },
  };
}

async function startServerWith(env, mapProvider) {
  const originalEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  delete process.env.MOTO_ADMIN_TOKEN;
  if (env.MOTO_ADMIN_TOKEN) process.env.MOTO_ADMIN_TOKEN = env.MOTO_ADMIN_TOKEN;
  try {
    const provider = createFixtureProvider();
    const server = createGateway({
      provider, mapProvider, allowedOrigin: "*", providerMode: "amap",
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    return {
      url: (path) => `http://127.0.0.1:${port}${path}`,
      close: () => new Promise((resolve) => server.close(resolve)),
    };
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in originalEnv)) delete process.env[k];
    }
    Object.assign(process.env, originalEnv);
  }
}

test("warm-cache rejects requests without admin token", async () => {
  const fakeMap = createFakeMapProvider();
  const env = { MOTO_PROVIDER: "amap", AMAP_WEB_SERVICE_KEY: "test-key" };
  const srv = await startServerWith(env, fakeMap);
  try {
    // No token configured -> endpoint returns 503 (server not configured)
    const noTokenConfigured = await fetch(srv.url("/v1/admin/warm-cache"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bbox: { z: 15, xMin: 27000, xMax: 27000, yMin: 13000, yMax: 13000 } }),
    });
    assert.equal(noTokenConfigured.status, 503);
  } finally {
    await srv.close();
  }
});

test("warm-cache rejects bad token with 401", async () => {
  const fakeMap = createFakeMapProvider();
  const env = { MOTO_PROVIDER: "amap", AMAP_WEB_SERVICE_KEY: "test-key", MOTO_ADMIN_TOKEN: "secret-token" };
  const originalToken = process.env.MOTO_ADMIN_TOKEN;
  process.env.MOTO_ADMIN_TOKEN = "secret-token";
  const srv = await startServerWith({}, fakeMap);
  try {
    const wrongToken = await fetch(srv.url("/v1/admin/warm-cache"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": "wrong-token" },
      body: JSON.stringify({ bbox: { z: 15, xMin: 27000, xMax: 27000, yMin: 13000, yMax: 13000 } }),
    });
    assert.equal(wrongToken.status, 401);
  } finally {
    await srv.close();
    if (originalToken === undefined) delete process.env.MOTO_ADMIN_TOKEN;
    else process.env.MOTO_ADMIN_TOKEN = originalToken;
  }
});

test("warm-cache rejects bbox larger than max", async () => {
  const fakeMap = createFakeMapProvider();
  process.env.MOTO_ADMIN_TOKEN = "secret-token";
  const srv = await startServerWith({}, fakeMap);
  try {
    const tooBig = await fetch(srv.url("/v1/admin/warm-cache"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": "secret-token" },
      body: JSON.stringify({ bbox: { z: 15, xMin: 27000, xMax: 27500, yMin: 13000, yMax: 13500 } }),
    });
    assert.equal(tooBig.status, 400);
    const body = await tooBig.json();
    assert.match(body.error.message, /bbox too large/);
  } finally {
    await srv.close();
  }
});

test("warm-cache accepts valid request and pre-fetches all tiles", async () => {
  const fakeMap = createFakeMapProvider();
  process.env.MOTO_ADMIN_TOKEN = "secret-token";
  const srv = await startServerWith({}, fakeMap);
  try {
    const accept = await fetch(srv.url("/v1/admin/warm-cache"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": "secret-token" },
      body: JSON.stringify({ bbox: { z: 15, xMin: 27000, xMax: 27001, yMin: 13000, yMax: 13001 } }),
    });
    assert.equal(accept.status, 202);
    const body = await accept.json();
    assert.equal(body.total_tiles, 4);  // 2x2 = 4 tiles
    assert.equal(body.accepted, true);

    // Wait for background warmup to finish (4 tiles / concurrency 16 = immediate)
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(fakeMap.calls.length, 4);
    const seen = new Set(fakeMap.calls.map((c) => `${c.x},${c.y}`));
    assert.ok(seen.has("27000,13000"));
    assert.ok(seen.has("27001,13001"));
  } finally {
    await srv.close();
  }
});

test("warm-cache rejects invalid bbox", async () => {
  const fakeMap = createFakeMapProvider();
  process.env.MOTO_ADMIN_TOKEN = "secret-token";
  const srv = await startServerWith({}, fakeMap);
  try {
    const invalid = await fetch(srv.url("/v1/admin/warm-cache"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": "secret-token" },
      body: JSON.stringify({ bbox: { z: 15, xMin: 27500, xMax: 27000, yMin: 13000, yMax: 13000 } }),
    });
    assert.equal(invalid.status, 400);
    const noBbox = await fetch(srv.url("/v1/admin/warm-cache"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": "secret-token" },
      body: JSON.stringify({}),
    });
    assert.equal(noBbox.status, 400);
  } finally {
    await srv.close();
  }
});