# Binance Futures Kline Excel Exporter

Production-ready Vite + React + TypeScript app that fetches Binance USD-M futures klines for multiple intervals, retries robustly on throttling/transient errors, persists job progress, and exports a single `.xlsx` workbook.

## Features

- Symbol input (`BTCUSDT` default) with uppercase normalization and format validation
- Binance USD-M Futures endpoint support:
  - Base: `https://fapi.binance.com`
  - Endpoint: `/fapi/v1/klines`
  - Params: `symbol`, `interval`, `limit=1000`
- Intervals (1000 candles each): `1m`, `5m`, `15m`, `1h`, `2h`, `4h`, `12h`, `1w`, `1M`
- Queue with `concurrency=1` (one interval task at a time)
- Retry behavior for `429`, `418`, `5xx`, network/timeouts:
  - exponential backoff + jitter (max 60s)
  - honors `Retry-After`/similar headers when present
  - UI shows `Waiting to retry in N seconds...`
- Persistence with IndexedDB fallback to localStorage
  - saves after each interval succeeds
  - saves queue state to resume after refresh/tab close
- Auto-resume toggle (default ON)
- Reset/clear saved state button
- Excel export (`xlsx` / SheetJS)
  - one worksheet per interval
  - `meta` sheet with summary and notes

## Project Structure

```text
src/
  api/binance.ts
  core/storage.ts
  core/taskRunner.ts
  core/excel.ts
  components/
    ProgressList.tsx
    LogPanel.tsx
    SettingsAccordion.tsx
```

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Run dev server:

```bash
npm run dev
```

3. Build production files:

```bash
npm run build
```

4. Preview build locally:

```bash
npm run preview
```

## GitHub Pages Deployment

A workflow is included at `.github/workflows/deploy-pages.yml` and deploys on push to `main`.

1. Push repository to GitHub.
2. In GitHub repo settings, open **Pages**.
3. Set source to **GitHub Actions**.
4. Push to `main` and let the workflow deploy.

## Vite Base Path for Pages

`vite.config.ts` resolves base path in this order:

1. `VITE_BASE_PATH` (manual override)
2. On GitHub Actions, `/${repo-name}/`
3. Local default: `/`

If needed, set explicit base path:

```bash
VITE_BASE_PATH=/your-repo-name/ npm run build
```

## CORS and Proxy Option

The app tries direct browser calls to Binance first. If CORS blocks, set **Proxy Base URL** in settings, for example:

`https://your-proxy-domain.example.com`

Then requests go to:

`{proxyBaseUrl}/fapi/v1/klines?...`

## Example Serverless Proxy

Example Node/Express-like handler for public market data forwarding:

```ts
import type { Request, Response } from "express";

export async function klinesProxy(req: Request, res: Response) {
  const qs = new URLSearchParams(req.query as Record<string, string>);
  const url = `https://fapi.binance.com/fapi/v1/klines?${qs.toString()}`;

  const upstream = await fetch(url, { method: "GET" });
  const body = await upstream.text();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.status(upstream.status).send(body);
}
```

For serverless environments, expose it as `GET /fapi/v1/klines` (or `/klines`) and keep it GET-only for public data.
