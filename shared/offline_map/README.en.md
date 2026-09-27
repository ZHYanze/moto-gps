> **Language:** English · [中文](README.md)

> English edition of the Chinese document. The Chinese file is authoritative if the two differ.

# Dalian offline mini-map package v1

`dalian-v1.sqlite` is the full Dalian offline scene database used by the MOTO GPS iPhone app. It
is not a pre-drawn demo line and it does not cache AMap or OSM online tiles; it is queryable
vector data generated from real OpenStreetMap geometry:

- clipped exactly by the OSM Dalian municipal boundary relation `2764565`;
- keeps roads usable by motor vehicles and excludes roads explicitly marked `access/private/no`;
- keeps building outlines that actually exist in OSM and does not generate or draw in buildings;
- WGS84 coordinates are converted uniformly to the GCJ-02 E6 used by the navigation chain;
- roads and buildings each get a SQLite R-tree and the phone only queries 500–800 m around the
  vehicle;
- the terminal still receives only the current window and does not need the whole-city data
  inside the ESP32.

## 2026-09-27 measured data

| Metric | Value |
| --- | ---: |
| SQLite file | 9.57 MiB / 10,037,248 bytes |
| Road polylines | 33,714 |
| Building outlines | 34,343 |
| Candidate roads in the Zhongshan Square demo area | 303 |
| Candidate buildings in the Zhongshan Square demo area | 751 |
| SHA-256 | see `dalian-v1.manifest.json` |

The hash in `dalian-v1.manifest.json` is authoritative; regeneration with unchanged input versions
gives a deterministic result.

## File format

The database schema is in `dalian-v1.sql`. The core conventions:

- `metadata`: version, coordinate system, source, attribution, data date and statistics;
- `roads` / `road_rtree`: road geometry and extent index;
- `buildings` / `building_rtree`: building outlines and extent index;
- `points` BLOB: repeated little-endian `[int32 lat_e6, int32 lon_e6]`;
- the first building point is not repeated at the end, and the renderer closes the ring;
- multi-polygon buildings generated from an OSM relation keep their source type with a negative
  `osm_way_id`;
- building interior holes are omitted in v1. The 466×466 grey background blocks do not need hole
  information.

Road class: `0 motorway`, `1 primary`, `2 secondary`, `3 residential`, `4 service`, `5 other`.
Building class: `0 generic`, `1 landmark`, `2 parking`.

## Feasibility boundary

This scheme lets any navigation position inside Dalian draw on the same high-density offline road
database; but "having data" does not mean the screen draws all of it at once. The iPhone first
filters several hundred candidate features by distance and road class, and BLE v1 sends at most
24 roads, 192 road points, 16 buildings and 128 building points per window, matching the 466×466
round display. If the real hardware still looks too sparse, the next step is to adjust the window
selection and the BLE capacity, not to fabricate background lines.

OSM building coverage is not uniform: central urban areas are usually denser, while suburbs or
newly built parks may lack outlines. Missing buildings can only be added later from a lawful data
source or by a measured survey; the current package does not guess building positions.

## Licensing and attribution

The data comes from OpenStreetMap and uses ODbL 1.0. The product UI or an "About / Map data" page
must provide a discoverable `© OpenStreetMap contributors` attribution and a licence link.
Building an offline package by bulk-downloading `tile.openstreetmap.org` tiles is forbidden; this
project uses the PBF data provided by Geofabrik.

- Data source: https://download.geofabrik.de/asia/china/liaoning.html
- Attribution guidelines: https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- ODbL: https://opendatacommons.org/licenses/odbl/1-0/

## Regenerating

Dependencies: `osmium-tool`, `jq`, Node.js 22+ (needs the built-in `node:sqlite`).

```bash
mkdir -p tmp/offline_map_source
curl -L https://download.geofabrik.de/asia/china/liaoning-latest.osm.pbf \
  -o tmp/offline_map_source/liaoning-latest.osm.pbf

# extract_city.sh: Dalian relation=2764565, admin_level=5, division_code=210200
bash scripts/offline_map/extract_city.sh \
  dalian \
  tmp/offline_map_source/liaoning-latest.osm.pbf \
  2764565 \
  5 \
  210200 \
  https://download.geofabrik.de/asia/china/liaoning-latest.osm.pbf

node scripts/offline_map/build_jinan_sqlite.mjs \
  tmp/offline_map_source/dalian-roads-buildings.geojsonseq \
  shared/offline_map/dalian-v1.sqlite

node scripts/offline_map/validate_jinan_sqlite.mjs
```

The first step produces the boundary, the tags-filtered PBF cropped to Dalian and the GeoJSONSeq
intermediate files; the second step generates the SQLite and the manifest; the third step decodes
every geometry one by one and validates the boundary, the point counts, the R-tree, the version,
the coordinate ranges and the Zhongshan Square density.
`validate_jinan_sqlite.mjs` automatically scans every
`shared/offline_map/*-v1.sqlite` and runs the per-city checks from its `KNOWN_BBOXES` table.