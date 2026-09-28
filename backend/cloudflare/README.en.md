> **Language:** English · [中文](README.md)
>
> The Chinese version is authoritative if the two versions differ.

# Deploy with Cloudflare Workers + R2

This is an additional deployment option requested in
[issue #2](https://github.com/mx3353672833-debug/moto-gps-waveshare/issues/2).
The existing [Node.js server deployment](../README.en.md), its commands and defaults remain available.
Both deployments reuse the search, routing, city, map conversion and protocol validation code.
iOS and ESP32 keep the same protocol.

```text
iPhone → your Worker HTTPS endpoint → AMap (places / routes / city boundaries)
                                   → Protomaps PMTiles (roads / buildings on demand)
                                   ↔ private R2 (converted map tiles / source metadata)
```

R2 stores map cache data, not AMap keys, user searches or route responses. This does not add OTA firmware hosting.
Configure the AMap key as a Worker Secret. You need your own Cloudflare account and AMap permissions;
the repository does not provide a public navigation service. The existing OSM/ODbL attribution is preserved.

## 1. Test locally

Install Node.js 22+ (24 recommended) and npm. From the repository root:

```sh
npm ci --prefix backend
npm ci --prefix backend/cloudflare
npm test --prefix backend
npm test --prefix backend/cloudflare
```

The Workers checks run inside Miniflare / workerd using local R2 and controlled upstream responses.
No account or real key is needed. They cover routes and alternatives, places, cities, input validation,
rate limiting, compressed PMTiles decoding, R2 persistence, upstream failures and scheduled refresh.
Passing these checks does not verify mainland China connectivity or a real AMap account.

Enter this directory and copy `.dev.vars.example` to `.dev.vars`:

```sh
cd backend/cloudflare
cp .dev.vars.example .dev.vars
npm run dev
```

On Windows PowerShell, use `Copy-Item .dev.vars.example .dev.vars`; the npm commands are the same.
Open `http://localhost:8787/healthz`. The example uses **fixture mode**: synthetic routes, empty place
results and `ready_for_live_navigation=false`, without contacting AMap or online maps.
`.dev.vars` is local only; it does not configure the deployed Worker.

## 2. Create R2 and configure the Worker

Run the following commands from `backend/cloudflare`:

```sh
npx wrangler login
npx wrangler r2 bucket create moto-gps-map-cache
```

If you already use that bucket name, choose another and update `bucket_name` in `wrangler.jsonc`.
Keep the bucket private; no public bucket domain is required. Add an object lifecycle rule to delete
objects **under `tiles/` only after 30 days**, using R2 bucket Settings → Object lifecycle rules.
Missing tiles can be fetched again. Do not apply that rule to `metadata/`, which retains the last known map source.
R2 does not use the Node deployment's 1 GiB disk LRU: visited map area and lifecycle rules determine storage usage.

Edit `vars` in `wrangler.jsonc`:

| Setting | Purpose |
| --- | --- |
| `MOTO_PROVIDER` | Set to `amap` for live navigation; default `disabled`; `fixture` is for demos/tests only |
| `MOTO_MAP_PMTILES_URL` | `auto` selects a completed Protomaps build; alternatively a trusted HTTPS `.pmtiles` URL or `disabled` |
| `WEB_ORIGIN` | Allowed website origin, e.g. `https://nav.example.com`; use an empty string for native-app-only use |
| `MOTO_BASE_PATH` | Empty by default, exposing `/v1/...`; `/moto-gps/api` exposes `/moto-gps/api/v1/...`; no trailing slash |

`disabled` and `fixture` modes always disable online maps to keep tests offline.
Maps require the `MAP_CACHE` binding. Hosting private PMTiles archives is not included in this version;
a custom source must support HTTPS Range requests.

Set your AMap **Web Service key**:

```sh
npx wrangler secret put AMAP_WEB_SERVICE_KEY
```

Paste it at the prompt. Never put it in `wrangler.jsonc`, Git or an Issue. Live mode without a key returns
503 instead of a synthetic route. Your AMap account needs POI, driving route and administrative district
permissions and quota. For rejected requests, inspect account restrictions and the returned error code.
If you use an outbound IP allowlist, separately verify that Workers egress meets those restrictions.

## 3. Deploy and connect the app

```sh
npm run build
npm run deploy
```

`build` only bundles and checks the Worker. `deploy` uploads it to your own Cloudflare account.
Use the returned `https://moto-gps-gateway.<your-subdomain>.workers.dev/` URL, or follow
[Cloudflare's custom-domain setup](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
A custom domain alone does not guarantee mainland China connectivity.

Enter the deployed HTTPS base URL in the app’s 网关设置 (Gateway settings) and save to apply it immediately.
Source builds can still use `MOTOGPSGatewayBaseURL` in `platforms/ios/project.yml` as the default.
Without a Mac, use the [IPA installation guide](../../docs/IOS_SIDELOAD.en.md). With the default path:

```text
https://moto-gps-gateway.YOUR-SUBDOMAIN.workers.dev/
```

With `MOTO_BASE_PATH=/moto-gps/api`:

```text
https://nav.example.com/moto-gps/api/
```

Use the same prefix in verification requests below. No ESP32 firmware change is needed.
The original server remains available; to switch back, save its URL in the app’s gateway settings.

## 4. Verify your deployment

Replace the placeholder URL with your endpoint. On Windows use `curl.exe` to avoid PowerShell alias differences.

```sh
curl --fail-with-body https://YOUR-WORKER/healthz
curl --fail-with-body 'https://YOUR-WORKER/v1/places?keywords=%E6%B5%8E%E5%8D%97%E8%A5%BF%E7%AB%99'
curl --fail-with-body 'https://YOUR-WORKER/v1/map/cities?keywords=%E6%B5%8E%E5%8D%97'
curl --fail-with-body -H 'Content-Type: application/json' --data-binary @../fixtures/route-request-v1.json https://YOUR-WORKER/v1/routes
curl --fail-with-body -H 'Content-Type: application/json' --data-binary @../fixtures/route-request-v1.json https://YOUR-WORKER/v1/route-options
curl --fail-with-body https://YOUR-WORKER/v1/map/tiles/15/27044/12791
```

Check `provider=amap`, successful real searches/routes, roads and buildings in an uncached tile,
and a corresponding JSON object under R2 `tiles/`. A second tile request should use the cache.
`/healthz` reports configured capabilities; it does not contact AMap or the map source and does not
prove upstream availability. Speed limits and traffic-light countdown remain unsupported.

On a phone using cellular data in the intended region, test place searches, route planning, rerouting
and map downloads. Record latency and timeouts. The Issue's reported OTA throughput does not verify
these operations. This implementation does not add IP selection or promise network speeds.
Large tile decoding can reach Workers CPU, memory or subrequest limits; confirm plan quotas and costs
against the actual workload.

## Runtime behavior and limitations

- Existing routes and JSON contracts are preserved through Cloudflare's official Node HTTP adapter.
- PMTiles byte ranges are fetched on demand. The global map archive is not copied into R2.
- Each request owns its PMTiles I/O, avoiding shared pending operations between Worker requests.
  R2 tile cache and source metadata persist across requests.
- Automatic map metadata refreshes daily. Cached tiles return first, with stale data refreshed using
  `waitUntil`. Cron runs at 03:17 UTC. A source outage with no cached tile returns 503, never invented roads;
  existing cached tiles remain usable.
- R2 errors do not expose secrets. If a cache write fails, the retrieved real tile may still be returned,
  but a later request may have to fetch it again.
- Cloudflare per-IP limits are 30 route, 60 place, 30 city and 600 tile requests per minute.
  These are edge limits, not strict account-wide quotas. Use different `namespace_id` values for separate
  gateways to avoid shared quotas. Users behind one public IP share its allowance. CORS and rate limiting
  are not authentication; configure access protection for your intended audience.
- This addition does not switch a production domain or the app's default gateway. It provides code and
  instructions for an optional deployment.

References: [Workers Node HTTP](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/),
[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
