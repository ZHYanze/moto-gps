#!/usr/bin/env bash
# Extract motor-vehicle roads and buildings from a Geofabrik PBF for one
# Chinese prefecture-level city, producing a geojsonseq file ready for
# build_city_sqlite.mjs.
#
# Usage:
#   extract_city.sh <city-slug> <pbf-file> <boundary-relation-id> \
#                    <admin-level> <division-code> <source-url>
#
# Example (Dalian):
#   extract_city.sh dalian /path/liaoning-latest.osm.pbf r2764565 \
#                    5 210200 \
#                    https://download.geofabrik.de/asia/china/liaoning.html
#
# The output geojsonseq is written to:
#   <repo>/tmp/offline_map_source/<slug>-roads-buildings.geojsonseq
#
# Requirements: osmium-tool, jq.

set -euo pipefail

if [[ $# -lt 6 ]]; then
  echo "Usage: $0 <city-slug> <pbf-file> <boundary-relation-id> <admin-level> <division-code> <source-url>" >&2
  exit 1
fi

CITY_SLUG="$1"
PBF_FILE="$2"
BOUNDARY_RELATION_ID="$3"   # e.g. r2764565 (note leading "r")
ADMIN_LEVEL="$4"            # OSM admin_level of the city relation (4/5/6/...)
DIVISION_CODE="$5"          # e.g. 370100 for Jinan, 210200 for Dalian
SOURCE_URL="$6"

if [[ ! -s "${PBF_FILE}" ]]; then
  echo "Missing or empty PBF: ${PBF_FILE}" >&2
  exit 1
fi

command -v osmium >/dev/null || { echo "osmium-tool is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE_DIR="${ROOT_DIR}/tmp/offline_map_source"
mkdir -p "${SOURCE_DIR}"

source_timestamp="$(osmium fileinfo -e -g header.option.osmosis_replication_timestamp "${PBF_FILE}")"
source_sha256="$(sha256sum "${PBF_FILE}" | awk '{print $1}')"
boundary_relation_id_stripped="${BOUNDARY_RELATION_ID#r}"
jq -n \
  --arg source_url "${SOURCE_URL}" \
  --arg source_timestamp "${source_timestamp}" \
  --arg source_sha256 "${source_sha256}" \
  --arg boundary_relation "${boundary_relation_id_stripped}" \
  '{source_url:$source_url,source_timestamp:$source_timestamp,source_sha256:$source_sha256,boundary_relation:$boundary_relation}' \
  > "${SOURCE_DIR}/source-metadata.json"

boundary_geojson="${SOURCE_DIR}/${CITY_SLUG}-boundary.geojson"
boundary_osm_pbf="${SOURCE_DIR}/${CITY_SLUG}-boundary.osm.pbf"
roads_buildings_pbf="${SOURCE_DIR}/${CITY_SLUG}-roads-buildings.osm.pbf"
roads_buildings_geojsonseq="${SOURCE_DIR}/${CITY_SLUG}-roads-buildings.geojsonseq"

echo "Extracting the ${CITY_SLUG} administrative boundary (${BOUNDARY_RELATION_ID})..."
osmium getid "${PBF_FILE}" "${BOUNDARY_RELATION_ID}" -r \
  -o "${boundary_osm_pbf}" --overwrite
osmium export "${boundary_osm_pbf}" -f geojson \
  -o "${SOURCE_DIR}/${CITY_SLUG}-boundary-all.geojson" --overwrite

jq --arg admin_level "${ADMIN_LEVEL}" \
   --arg division_code "${DIVISION_CODE}" \
   '{type:"FeatureCollection",features:[.features[] | select(
      .geometry.type == "MultiPolygon" and
      .properties.boundary == "administrative" and
      .properties.admin_level == $admin_level and
      .properties.division_code == $division_code
    )]}' \
   "${SOURCE_DIR}/${CITY_SLUG}-boundary-all.geojson" \
   > "${boundary_geojson}"

feature_count="$(jq '.features | length' "${boundary_geojson}")"
if [[ "${feature_count}" != "1" ]]; then
  echo "Expected one ${CITY_SLUG} boundary feature, found ${feature_count}" >&2
  echo "Hint: re-check admin_level/division_code or use a more permissive query in this script." >&2
  exit 1
fi

echo "Cropping the source PBF to the ${CITY_SLUG} municipal boundary..."
# Use simple strategy by default to keep memory low on small VPS instances.
# (VPS OOM when complete_ways or smart strategies try to keep all referenced
# ways in memory.) Pass MOTO_EXTRACT_STRATEGY=smart to override.
EXTRACT_STRATEGY="${MOTO_EXTRACT_STRATEGY:-simple}"
osmium extract -p "${boundary_geojson}" "${PBF_FILE}" \
  --strategy="${EXTRACT_STRATEGY}" \
  -o "${SOURCE_DIR}/${CITY_SLUG}.osm.pbf" --overwrite

echo "Filtering motor-vehicle roads and real OSM buildings..."
osmium tags-filter "${SOURCE_DIR}/${CITY_SLUG}.osm.pbf" \
  'w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,unclassified,residential,living_street,service' \
  'w/building' 'r/building' \
  -o "${roads_buildings_pbf}" --overwrite

osmium export "${roads_buildings_pbf}" \
  -f geojsonseq \
  --geometry-types=linestring,polygon,multipolygon \
  --add-unique-id=type_id \
  -o "${roads_buildings_geojsonseq}" --overwrite

echo "Prepared ${roads_buildings_geojsonseq}"