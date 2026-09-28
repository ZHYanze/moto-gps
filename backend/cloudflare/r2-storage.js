import { MAXIMUM_TILE_BYTES } from "../src/map-cache.js";
import { readLimitedBody } from "../src/map-http.js";

// No route responses or AMap keys are persisted. This bucket is a private OSM cache.
async function readJson(bucket, key, maximumBytes) {
  const object = await bucket.get(key);
  if (!object) return null;
  if (object.size > maximumBytes) {
    await object.body.cancel();
    throw new Error("R2 object exceeds the size limit");
  }
  const bytes = await readLimitedBody(new Response(object.body), maximumBytes);
  return JSON.parse(bytes.toString("utf8"));
}

export function createR2Storage(bucket) {
  if (!bucket || typeof bucket.get !== "function" || typeof bucket.put !== "function") {
    throw new Error("MAP_CACHE R2 binding is required when maps are enabled");
  }
  const cache = {
    ready: Promise.resolve(),
    lastError: null,
    async get(name, { z, x, y }) {
      try {
        const value = await readJson(bucket, `tiles/${name}`, MAXIMUM_TILE_BYTES);
        if (!value) return null;
        if (value.schema_version !== 1 || value.coordinate_system !== "GCJ-02" ||
            value.tile?.z !== z || value.tile?.x !== x || value.tile?.y !== y ||
            !Array.isArray(value.roads) || !Array.isArray(value.buildings) ||
            !Number.isFinite(Date.parse(value.source?.retrieved_at)) ||
            typeof value.source?.source_revision !== "string" || !value.source.source_revision) {
          throw new Error("invalid cached map tile");
        }
        return value;
      } catch {
        cache.lastError = "MAP_CACHE_READ_FAILED";
        return null; // Corrupt/unavailable cache is a miss, never a fabricated map.
      }
    },
    async put(name, value) {
      const serialized = JSON.stringify(value);
      if (Buffer.byteLength(serialized) > MAXIMUM_TILE_BYTES) throw new Error("map tile too large");
      await bucket.put(`tiles/${name}`, serialized, {
        httpMetadata: { contentType: "application/json" },
      });
      cache.lastError = null;
    },
    status() {
      return { storage: "r2", last_error: cache.lastError };
    },
  };
  return {
    cache,
    readSource: (namespace) => readJson(bucket, `metadata/source-${namespace}.json`, 8192),
    writeSource: (namespace, value) => bucket.put(`metadata/source-${namespace}.json`, JSON.stringify(value), {
      httpMetadata: { contentType: "application/json" },
    }),
  };
}
