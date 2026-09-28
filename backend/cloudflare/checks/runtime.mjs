import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { zxyToTileId } from "pmtiles";
import { transformVectorTile } from "../../src/map-tiles.js";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const routeRequest = JSON.parse(await readFile(new URL("../../fixtures/route-request-v1.json", import.meta.url), "utf8"));
const routeFixture = await readFile(new URL("../../fixtures/amap-route-v2.json", import.meta.url), "utf8");
const mvt = await readFile(new URL("../../fixtures/protomaps-jinan-15-27044-12791.mvt", import.meta.url));
const sourceUrl = "https://maps.example.test/test.pmtiles";
const namespace = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);
const tileKey = (value) => `tiles/map-v1-${namespace(value)}-15-27044-12791.json`;

async function runtime(t, bindings = {}, outboundService = () => { throw new Error("unexpected network request"); }) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: fileURLToPath(new URL("../dist/worker.js", import.meta.url)),
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    bindings: { ...config.vars, ...bindings }, r2Buckets: ["MAP_CACHE"],
    ratelimits: Object.fromEntries(config.ratelimits.map(({ name, ...value }) => [name, value])),
    outboundService,
  }));
  t.after(() => mf.dispose());
  return mf;
}
const requestRoute = (mf, path = "/v1/routes", body = JSON.stringify(routeRequest), headers = {}) =>
  mf.dispatchFetch(`https://gateway.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });

// Tiny PMTiles v3 archive wrapping the repository's real MVT fixture. Both archive
// index and tile are gzip compressed so the real Workers decompressor is exercised.
function pmtilesFixture() {
  const bytes = [];
  function varint(n) { while (n >= 128) { bytes.push((n % 128) + 128); n = Math.floor(n / 128); } bytes.push(n); }
  const tile = gzipSync(mvt);
  for (const value of [1, zxyToTileId(15, 27044, 12791), 1, tile.length, 1]) varint(value);
  const directory = gzipSync(Buffer.from(bytes));
  const header = Buffer.alloc(127);
  header.write("PMTiles"); header[7] = 3;
  for (const [offset, value] of [[8, 127], [16, directory.length], [56, 127 + directory.length],
    [64, tile.length], [72, 1], [80, 1], [88, 1]]) header.writeBigUInt64LE(BigInt(value), offset);
  header[96] = 1; header[97] = 2; header[98] = 2; header[99] = 1; header[100] = 15; header[101] = 15;
  return Buffer.concat([header, directory, tile]);
}
function rangeResponse(request, archive) {
  const [, startText, endText] = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get("Range"));
  const start = Number(startText), end = Math.min(Number(endText), archive.length - 1);
  return new Response(archive.subarray(start, end + 1), { status: 206, headers: {
    "Content-Range": `bytes ${start}-${end}/${archive.length}`, "ETag": '"test-v1"',
  } });
}

test("disabled default is offline, reports no live readiness, and preserves errors/CORS", async (t) => {
  const mf = await runtime(t);
  const response = await mf.dispatchFetch("https://gateway.test/healthz");
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.ready_for_live_navigation, false);
  assert.equal(health.capabilities.surrounding_map, false);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), config.vars.WEB_ORIGIN);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const route = await requestRoute(mf);
  assert.equal(route.status, 503);
  assert.equal((await route.json()).error.code, "SERVER_MISCONFIGURED");
  assert.equal((await mf.dispatchFetch("https://gateway.test/unknown")).status, 404);
  assert.equal((await mf.dispatchFetch("https://gateway.test/v1/routes", { method: "OPTIONS" })).status, 204);
});

test("fixture routes, route options, validation and optional base path use the shared gateway", async (t) => {
  const mf = await runtime(t, { MOTO_PROVIDER: "fixture", MOTO_BASE_PATH: "/moto-gps/api" });
  assert.equal((await mf.dispatchFetch("https://gateway.test/healthz")).status, 404);
  const health = await (await mf.dispatchFetch("https://gateway.test/moto-gps/api/healthz")).json();
  assert.equal(health.ready_for_live_navigation, false);
  const route = await requestRoute(mf, "/moto-gps/api/v1/routes");
  assert.equal(route.status, 200);
  assert.equal((await route.json()).request_id, routeRequest.request_id);
  const options = await (await requestRoute(mf, "/moto-gps/api/v1/route-options")).json();
  assert.ok(options.routes.length >= 1 && options.routes.length <= 3);
  for (const [body, code] of [["{", "INVALID_JSON"], ["{}", "INVALID_REQUEST"], ['"' + "x".repeat(9000) + '"', "REQUEST_TOO_LARGE"]]) {
    const result = await requestRoute(mf, "/moto-gps/api/v1/routes", body);
    assert.equal(result.status, 400);
    assert.equal((await result.json()).error.code, code);
  }
});

test("live mode forwards route, POI and city queries to AMap without exposing its key", async (t) => {
  const seen = [];
  const mf = await runtime(t, { MOTO_PROVIDER: "amap", AMAP_WEB_SERVICE_KEY: "secret-test-key", MOTO_MAP_PMTILES_URL: "disabled" }, (request) => {
    const url = new URL(request.url); seen.push(url.pathname);
    assert.equal(url.hostname, "restapi.amap.com");
    assert.equal(url.searchParams.get("key"), "secret-test-key");
    if (url.pathname === "/v5/direction/driving") return new Response(routeFixture);
    if (url.pathname === "/v5/place/text") return Response.json({ status: "1", pois: [{ id: "test-poi", name: "济南站", location: "117.0,36.6" }] });
    if (url.pathname === "/v3/config/district") return Response.json({ status: "1", districts: [{ adcode: "370102", level: "district", name: "历下区", polyline: "117.1,36.6;117.2,36.6;117.2,36.7;117.1,36.7;117.1,36.6" }] });
    throw new Error("unexpected upstream");
  });
  const routes = await requestRoute(mf);
  assert.equal(routes.status, 200); assert.doesNotMatch(await routes.text(), /secret-test-key/);
  const places = await (await mf.dispatchFetch("https://gateway.test/v1/places?keywords=济南站")).json();
  assert.equal(places.places[0].name, "济南站");
  const cities = await (await mf.dispatchFetch("https://gateway.test/v1/map/cities?keywords=历下区")).json();
  assert.equal(cities.cities[0].id, "370102");
  assert.equal(seen.length, 3);
});

test("AMap rejection cannot fall back to a synthetic route or leak credentials", async (t) => {
  const mf = await runtime(t, { MOTO_PROVIDER: "amap", AMAP_WEB_SERVICE_KEY: "secret-test-key", MOTO_MAP_PMTILES_URL: "disabled" },
    () => Response.json({ status: "0", infocode: "10001", info: "secret-test-key" }));
  const result = await requestRoute(mf);
  assert.equal(result.status, 503);
  const text = await result.text();
  assert.doesNotMatch(text, /secret-test-key/);
  assert.equal(JSON.parse(text).error.code, "AMAP_10001");
  assert.equal(JSON.parse(text).route, undefined);
});

test("missing live key fails closed", async (t) => {
  const mf = await runtime(t, { MOTO_PROVIDER: "amap" });
  const response = await mf.dispatchFetch("https://gateway.test/healthz");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "SERVER_MISCONFIGURED");
});

test("rate limits cannot be bypassed using X-Real-IP", async (t) => {
  const mf = await runtime(t, { MOTO_PROVIDER: "fixture" });
  for (let i = 0; i < 30; i++) {
    const result = await requestRoute(mf, "/v1/routes", JSON.stringify(routeRequest), { "X-Real-IP": `192.0.2.${i}` });
    assert.equal(result.status, 200);
    await result.text();
  }
  const blocked = await requestRoute(mf);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("Retry-After"), "60");
});

test("uncached compressed PMTiles are transformed, stored in R2, and served during upstream outage", async (t) => {
  const archive = pmtilesFixture(); let requests = 0; let offline = false;
  const mf = await runtime(t, { MOTO_PROVIDER: "amap", AMAP_WEB_SERVICE_KEY: "test", MOTO_MAP_PMTILES_URL: sourceUrl }, (request) => {
    assert.equal(request.url, sourceUrl); requests++;
    if (offline) return new Response("down", { status: 503 });
    return rangeResponse(request, archive);
  });
  const result = await mf.dispatchFetch("https://gateway.test/v1/map/tiles/15/27044/12791");
  assert.equal(result.status, 200, await result.clone().text());
  const tile = await result.json();
  assert.equal(tile.coordinate_system, "GCJ-02");
  assert.ok(tile.roads.length > 0 && tile.buildings.length > 0);
  const bucket = await mf.getR2Bucket("MAP_CACHE");
  assert.deepEqual(await (await bucket.get(tileKey(sourceUrl))).json(), tile);
  const count = requests; offline = true;
  const cached = await mf.dispatchFetch("https://gateway.test/v1/map/tiles/15/27044/12791");
  assert.deepEqual(await cached.json(), tile); assert.equal(requests, count);
  assert.equal((await mf.dispatchFetch("https://gateway.test/v1/map/tiles/14/1/1")).status, 400);
  assert.equal((await mf.dispatchFetch("https://gateway.test/v1/map/tiles/15/1/1?url=https://evil.test")).status, 400);
});

test("corrupt R2 cache is replaced from the actual PMTiles source", async (t) => {
  const archive = pmtilesFixture();
  const mf = await runtime(t, { MOTO_PROVIDER: "amap", AMAP_WEB_SERVICE_KEY: "test", MOTO_MAP_PMTILES_URL: sourceUrl }, (request) => rangeResponse(request, archive));
  const bucket = await mf.getR2Bucket("MAP_CACHE");
  await bucket.put(tileKey(sourceUrl), '{"invalid":true}');
  const result = await mf.dispatchFetch("https://gateway.test/v1/map/tiles/15/27044/12791");
  assert.equal(result.status, 200);
  const tile = await result.json(); assert.ok(tile.roads.length > 0);
  assert.deepEqual(await (await bucket.get(tileKey(sourceUrl))).json(), tile);
});

test("auto source metadata survives requests and cached tiles survive metadata outage", async (t) => {
  let calls = 0;
  const mf = await runtime(t, { MOTO_PROVIDER: "amap", AMAP_WEB_SERVICE_KEY: "test" }, () => {
    calls++; return new Response("down", { status: 503 });
  });
  const bucket = await mf.getR2Bucket("MAP_CACHE");
  const tile = transformVectorTile(mvt, { z: 15, x: 27044, y: 12791, revision: "20260920" });
  await bucket.put(tileKey("protomaps-auto"), JSON.stringify(tile));
  await bucket.put(`metadata/source-${namespace("protomaps-auto")}.json`, JSON.stringify({
    url: "https://build.protomaps.com/20260920.pmtiles", revision: "20260920", refreshed_at_ms: Date.now(),
  }));
  const result = await mf.dispatchFetch("https://gateway.test/v1/map/tiles/15/27044/12791");
  assert.deepEqual(await result.json(), tile); assert.equal(calls, 0);
  await bucket.delete(`metadata/source-${namespace("protomaps-auto")}.json`);
  const offline = await mf.dispatchFetch("https://gateway.test/v1/map/tiles/15/27044/12791");
  assert.deepEqual(await offline.json(), tile);
});

test("scheduled source refresh writes metadata to R2", async (t) => {
  const mf = await runtime(t, { MOTO_PROVIDER: "amap", AMAP_WEB_SERVICE_KEY: "test" }, (request) => {
    assert.equal(request.url, "https://build-metadata.protomaps.dev/builds.json");
    return Response.json([{ key: "20260920.pmtiles", size: 1024, uploaded: "2026-09-20T00:00:00Z", version: "4.0.0" }]);
  });
  const worker = await mf.getWorker();
  await worker.scheduled({ cron: "17 3 * * *" });
  const bucket = await mf.getR2Bucket("MAP_CACHE");
  const metadata = await (await bucket.get(`metadata/source-${namespace("protomaps-auto")}.json`)).json();
  assert.equal(metadata.revision, "20260920");
  assert.ok(metadata.refreshed_at_ms > 0);
});

test("map redirects are rejected instead of followed", async (t) => {
  let requests = 0;
  const mf = await runtime(t, { MOTO_PROVIDER: "amap", AMAP_WEB_SERVICE_KEY: "test", MOTO_MAP_PMTILES_URL: sourceUrl }, (request) => {
    requests++;
    assert.equal(request.url, sourceUrl);
    return new Response(null, { status: 302, headers: { Location: "https://unexpected.test/private" } });
  });
  const result = await mf.dispatchFetch("https://gateway.test/v1/map/tiles/15/27044/12791");
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, "MAP_UPSTREAM_UNAVAILABLE");
  assert.equal(requests, 1);
  const bucket = await mf.getR2Bucket("MAP_CACHE");
  assert.equal(await bucket.get(tileKey(sourceUrl)), null);
});

test("concurrent uncached map requests own their I/O and persist valid tiles", async (t) => {
  const archive = pmtilesFixture();
  const mf = await runtime(t, { MOTO_PROVIDER: "amap", AMAP_WEB_SERVICE_KEY: "test", MOTO_MAP_PMTILES_URL: sourceUrl }, (request) => rangeResponse(request, archive));
  const results = await Promise.all(Array.from({ length: 4 }, () => mf.dispatchFetch("https://gateway.test/v1/map/tiles/15/27044/12791")));
  for (const result of results) {
    assert.equal(result.status, 200);
    assert.ok((await result.json()).roads.length > 0);
  }
  const bucket = await mf.getR2Bucket("MAP_CACHE");
  assert.ok((await (await bucket.get(tileKey(sourceUrl))).json()).roads.length > 0);
});
