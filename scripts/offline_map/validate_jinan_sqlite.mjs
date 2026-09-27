#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "../..");
const offlineMapDirectory = path.join(rootDirectory, "shared/offline_map");
// Per-city bounding box used by the geometry sanity checks. Defaults are
// baked in for Jinan and Dalian; unknown slugs fall back to CITY_BBOX_* env
// vars or to the largest sensible global envelope.
const KNOWN_BBOXES = {
  jinan: { latMin: 35, latMax: 39, lonMin: 115, lonMax: 120 },
  // Dalian land bbox is ~121–123.5°E, but OSM ways that cross the boundary
  // (e.g. the Dalian-Yantai ferry / bridges into Shandong) extend further.
  // The simple extract strategy keeps these whole, so we widen the bbox
  // a degree on each side.
  dalian: { latMin: 38, latMax: 40.5, lonMin: 120, lonMax: 124 },
};
function bboxForSlug(slug) {
  if (process.env[`CITY_BBOX_${slug.toUpperCase()}`]) {
    const [latMin, lonMin, latMax, lonMax] = process.env[`CITY_BBOX_${slug.toUpperCase()}`]
      .split(",").map(Number);
    return { latMin, latMax, lonMin, lonMax };
  }
  if (KNOWN_BBOXES[slug]) return KNOWN_BBOXES[slug];
  if (process.env.CITY_BBOX_LAT_MIN) {
    return {
      latMin: Number.parseFloat(process.env.CITY_BBOX_LAT_MIN),
      latMax: Number.parseFloat(process.env.CITY_BBOX_LAT_MAX ?? "90"),
      lonMin: Number.parseFloat(process.env.CITY_BBOX_LON_MIN),
      lonMax: Number.parseFloat(process.env.CITY_BBOX_LON_MAX ?? "180"),
    };
  }
  return { latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 };
}
function resolveTargets() {
  const arg = process.argv[2];
  if (arg && fs.existsSync(arg)) {
    return [arg];
  }
  if (!fs.existsSync(offlineMapDirectory)) {
    throw new Error(`No offline_map directory at ${offlineMapDirectory}`);
  }
  const databases = fs.readdirSync(offlineMapDirectory)
    .filter((name) => /-v1\.sqlite$/.test(name))
    .map((name) => path.join(offlineMapDirectory, name));
  if (databases.length === 0) {
    throw new Error(`No *-v1.sqlite files in ${offlineMapDirectory}`);
  }
  return databases;
}

const KNOWN_DEMO_BBOXES = {
  jinan: {
    minLat: 36_668_000,
    maxLat: 36_681_000,
    minLon: 117_120_000,
    maxLon: 117_140_000,
  },
  // Dalian 中山广场 / 友好广场 一带,作为离线覆盖密度抽查的替代地标。
  dalian: {
    minLat: 38_915_000,
    maxLat: 38_925_000,
    minLon: 121_615_000,
    maxLon: 121_635_000,
  },
};
function demoBboxForSlug(slug) {
  if (process.env.CITY_DEMO_BBOX) {
    const [minLat, minLon, maxLat, maxLon] = process.env.CITY_DEMO_BBOX
      .split(",").map(Number);
    return {
      minLat: minLat * 1_000_000,
      minLon: minLon * 1_000_000,
      maxLat: maxLat * 1_000_000,
      maxLon: maxLon * 1_000_000,
    };
  }
  return KNOWN_DEMO_BBOXES[slug] ?? KNOWN_DEMO_BBOXES.jinan;
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function decodePoint(buffer, byteOffset) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return [view.getInt32(byteOffset, true), view.getInt32(byteOffset + 4, true)];
}

function slugFromPath(databasePath) {
  const baseName = path.basename(databasePath, ".sqlite");
  const match = /^(.+)-v\d+$/.exec(baseName);
  return match ? match[1] : baseName;
}

function validateDatabase(databasePath) {
  const slug = slugFromPath(databasePath);
  const cityBbox = bboxForSlug(slug);
  const demoBbox = demoBboxForSlug(slug);

  invariant(fs.existsSync(databasePath), `Missing database: ${databasePath}`);
  const database = new DatabaseSync(databasePath, { readOnly: true });

  const metadata = Object.fromEntries(
    database.prepare("SELECT key,value FROM metadata").all()
      .map(({ key, value }) => [key, value]),
  );
  invariant(metadata.schema_version === "1", "schema_version must be 1");
  invariant(metadata.coordinate_system === "GCJ-02", "coordinate_system must be GCJ-02");
  invariant(metadata.attribution?.includes("OpenStreetMap"), "OSM attribution is missing");
  invariant(
    database.prepare("PRAGMA user_version").get().user_version === 1,
    "user_version must be 1",
  );
  invariant(
    database.prepare("PRAGMA application_id").get().application_id === 0x4d475053,
    "application_id must be MGPS",
  );
  invariant(
    database.prepare("PRAGMA integrity_check").get().integrity_check === "ok",
    "integrity_check failed",
  );

  const roadCount = database.prepare("SELECT count(*) count FROM roads").get().count;
  const roadRtreeCount = database.prepare("SELECT count(*) count FROM road_rtree").get().count;
  const buildingCount = database.prepare("SELECT count(*) count FROM buildings").get().count;
  const buildingRtreeCount = database.prepare("SELECT count(*) count FROM building_rtree").get().count;
  invariant(roadCount === roadRtreeCount, "road R-tree count mismatch");
  invariant(buildingCount === buildingRtreeCount, "building R-tree count mismatch");
  invariant(roadCount > 10_000, "road coverage is unexpectedly sparse");
  invariant(buildingCount > 10_000, "building coverage is unexpectedly sparse");

  const invalidRoads = database.prepare(`
    SELECT count(*) count FROM roads
    WHERE osm_way_id IS NULL
       OR length(points) < 16 OR length(points) % 8 != 0
       OR class NOT BETWEEN 0 AND 5
       OR min_lat_e6 > max_lat_e6 OR min_lon_e6 > max_lon_e6
  `).get().count;
  invariant(invalidRoads === 0, `${invalidRoads} invalid road rows`);

  const invalidBuildings = database.prepare(`
    SELECT count(*) count FROM buildings
    WHERE osm_way_id IS NULL
       OR length(points) < 24 OR length(points) % 8 != 0
       OR class NOT BETWEEN 0 AND 2
       OR min_lat_e6 > max_lat_e6 OR min_lon_e6 > max_lon_e6
  `).get().count;
  invariant(invalidBuildings === 0, `${invalidBuildings} invalid building rows`);

  for (const table of ["roads", "buildings"]) {
    const rows = database.prepare(`
      SELECT id,min_lat_e6,max_lat_e6,min_lon_e6,max_lon_e6,points FROM ${table}
    `).iterate();
    for (const row of rows) {
      const pointCount = row.points.length / 8;
      let minimumLatitude = Number.POSITIVE_INFINITY;
      let maximumLatitude = Number.NEGATIVE_INFINITY;
      let minimumLongitude = Number.POSITIVE_INFINITY;
      let maximumLongitude = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < pointCount; index += 1) {
        const [latitude, longitude] = decodePoint(row.points, index * 8);
        invariant(
          latitude >= cityBbox.latMin * 1_000_000 && latitude <= cityBbox.latMax * 1_000_000,
          `${table} ${row.id}: latitude out of range`,
        );
        invariant(
          longitude >= cityBbox.lonMin * 1_000_000 && longitude <= cityBbox.lonMax * 1_000_000,
          `${table} ${row.id}: longitude out of range`,
        );
        minimumLatitude = Math.min(minimumLatitude, latitude);
        maximumLatitude = Math.max(maximumLatitude, latitude);
        minimumLongitude = Math.min(minimumLongitude, longitude);
        maximumLongitude = Math.max(maximumLongitude, longitude);
      }
      invariant(
        minimumLatitude === row.min_lat_e6 && maximumLatitude === row.max_lat_e6 &&
        minimumLongitude === row.min_lon_e6 && maximumLongitude === row.max_lon_e6,
        `${table} ${row.id}: stored bounds do not match geometry`,
      );
      if (table === "buildings") {
        const first = decodePoint(row.points, 0);
        const last = decodePoint(row.points, row.points.length - 8);
        invariant(
          first[0] !== last[0] || first[1] !== last[1],
          `building ${row.id}: ring is repeated closed`,
        );
      }
    }
  }

  const nearbyRoads = database.prepare(`
    SELECT count(*) count FROM road_rtree
    WHERE max_lat_e6 >= ? AND min_lat_e6 <= ?
      AND max_lon_e6 >= ? AND min_lon_e6 <= ?
  `).get(demoBbox.minLat, demoBbox.maxLat, demoBbox.minLon, demoBbox.maxLon).count;
  const nearbyBuildings = database.prepare(`
    SELECT count(*) count FROM building_rtree
    WHERE max_lat_e6 >= ? AND min_lat_e6 <= ?
      AND max_lon_e6 >= ? AND min_lon_e6 <= ?
  `).get(demoBbox.minLat, demoBbox.maxLat, demoBbox.minLon, demoBbox.maxLon).count;
  invariant(nearbyRoads >= 100, `${slug}: demo neighbourhood roads are unexpectedly sparse`);
  invariant(nearbyBuildings >= 100, `${slug}: demo neighbourhood buildings are unexpectedly sparse`);

  const roadPoints = database.prepare("SELECT sum(length(points)/8) count FROM roads").get().count;
  const buildingPoints = database.prepare("SELECT sum(length(points)/8) count FROM buildings").get().count;
  const byteSize = fs.statSync(databasePath).size;
  database.close();

  return {
    database: databasePath,
    schemaVersion: metadata.schema_version,
    coordinateSystem: metadata.coordinate_system,
    byteSize,
    mebibytes: Number((byteSize / 1024 / 1024).toFixed(2)),
    roads: Number(roadCount),
    roadPoints: Number(roadPoints),
    buildings: Number(buildingCount),
    buildingPoints: Number(buildingPoints),
    demoNeighbourhood: {
      roads: Number(nearbyRoads),
      buildings: Number(nearbyBuildings),
    },
    integrity: "ok",
  };
}

const reports = resolveTargets().map((databasePath) => validateDatabase(databasePath));
if (reports.length === 1) {
  console.log(JSON.stringify(reports[0], null, 2));
} else {
  console.log(JSON.stringify({ databases: reports }, null, 2));
}