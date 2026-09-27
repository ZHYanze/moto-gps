#!/usr/bin/env node

// Builds one auditable offline MapScene sample around the Zhongshan Square area.
// It fetches OSM vector entities (never rendered tiles), converts them through
// the same WGS84 -> GCJ-02 implementation as navigation, and records source
// way IDs.  This is a protocol/renderer fixture, not a complete Dalian pack.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { wgs84ToGcj02 } from "../backend/src/coordinates.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const outputPath = path.join(
  repositoryRoot,
  "shared/demo_fixture/dalian_map_scene_sample.json",
);
const bbox = [121.6275, 38.9170, 121.6340, 38.9200];
const originWgs84 = [38.918500, 121.630800];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function toGcjE6([latitude, longitude]) {
  const converted = wgs84ToGcj02({
    latitude_deg: latitude,
    longitude_deg: longitude,
  });
  return [
    Math.round(converted.latitude_deg * 1_000_000),
    Math.round(converted.longitude_deg * 1_000_000),
  ];
}

function classifyRoad(highway) {
  if (["motorway", "motorway_link", "trunk", "trunk_link"].includes(highway)) {
    return "motorway";
  }
  if (["primary", "primary_link"].includes(highway)) return "primary";
  if (["secondary", "secondary_link", "tertiary", "tertiary_link"].includes(highway)) {
    return "secondary";
  }
  if (["residential", "living_street", "unclassified"].includes(highway)) {
    return "residential";
  }
  if (["service", "track"].includes(highway)) return "service";
  return "other";
}

function squaredDistanceToOrigin(points) {
  const latitude = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const longitude = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return (latitude - originWgs84[0]) ** 2 + (longitude - originWgs84[1]) ** 2;
}

const response = await fetch(
  `https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox.join(",")}`,
  { headers: { "User-Agent": "MOTO-GPS-prototype/0.1 (offline map scene fixture)" } },
);
invariant(response.ok, `OSM map request failed with HTTP ${response.status}`);
const osm = await response.json();
const nodes = new Map(
  osm.elements
    .filter((element) => element.type === "node")
    .map((node) => [node.id, [node.lat, node.lon]]),
);

let buildingPointCount = 0;
const buildingCandidates = osm.elements
  .filter((element) => element.type === "way" && element.tags?.building)
  .map((way) => {
    const ring = way.nodes.map((nodeId) => nodes.get(nodeId));
    invariant(ring.every(Boolean), `building way ${way.id} has missing nodes`);
    if (ring.length >= 2 && ring[0][0] === ring.at(-1)[0] &&
        ring[0][1] === ring.at(-1)[1]) {
      ring.pop();
    }
    return { way, ring, distance: squaredDistanceToOrigin(ring) };
  })
  .filter(({ ring }) => ring.length >= 3 && ring.length <= 32)
  .sort((a, b) => a.distance - b.distance);
const buildings = [];
for (const { way, ring } of buildingCandidates) {
  if (buildings.length >= 16) break;
  if (buildingPointCount + ring.length > 128) continue;
  buildingPointCount += ring.length;
  buildings.push({
    osm_way_id: way.id,
    ...(way.tags.name ? { name: way.tags.name } : {}),
    class: way.tags.name ? "landmark" :
      way.tags.building === "parking" ? "parking" : "generic",
    points_e6: ring.map(toGcjE6),
  });
}

// Roads and buildings both come from the same OSM bbox above; nothing is
// reused from the demo-navigation route fixture.
const roadCandidates = osm.elements
  .filter((element) => element.type === "way" && element.tags?.highway)
  .map((way) => {
    const points = way.nodes.map((nodeId) => nodes.get(nodeId));
    invariant(points.every(Boolean), `road way ${way.id} has missing nodes`);
    return {
      way,
      points,
      distance: squaredDistanceToOrigin(points),
      pointCount: points.length,
    };
  })
  .filter(({ pointCount }) => pointCount >= 2 && pointCount <= 32)
  .sort((a, b) => a.distance - b.distance);

const roads = [];
let roadPointCount = 0;
for (const { way, points, pointCount } of roadCandidates) {
  if (roads.length >= 24) break;
  if (roadPointCount + pointCount > 192) continue;
  roadPointCount += pointCount;
  roads.push({
    osm_way_id: way.id,
    class: classifyRoad(way.tags.highway),
    ...(way.tags.name ? { name: way.tags.name } : {}),
    points_e6: points.map(toGcjE6),
  });
}

invariant(roads.length <= 24, "road count exceeds MapScene capacity");
invariant(
  roads.reduce((sum, road) => sum + road.points_e6.length, 0) <= 192,
  "road point count exceeds MapScene capacity",
);

const scene = {
  schema_version: 1,
  coordinate_system: "GCJ-02",
  scene_revision: 1,
  view_origin_e6: toGcjE6(originWgs84),
  radius_m: 650,
  roads,
  buildings,
  source: {
    provider: "OpenStreetMap",
    licence: "ODbL-1.0",
    attribution_url: "https://www.openstreetmap.org/copyright",
    retrieved_at: new Date().toISOString(),
    bbox_wgs84: bbox,
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(scene, null, 2)}\n`);
console.log(
  `wrote ${path.relative(repositoryRoot, outputPath)}: ` +
  `${roads.length} roads, ${buildings.length} buildings, ` +
  `${buildingPointCount} building points`,
);
