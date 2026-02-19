import type { CandleRow, Interval } from "../types";

const DEFAULT_BASE_URL = "https://fapi.binance.com";

export class BinanceApiError extends Error {
  status?: number;
  retryAfterMs?: number;
  retryable: boolean;

  constructor(message: string, options?: { status?: number; retryAfterMs?: number; retryable?: boolean }) {
    super(message);
    this.name = "BinanceApiError";
    this.status = options?.status;
    this.retryAfterMs = options?.retryAfterMs;
    this.retryable = options?.retryable ?? false;
  }
}

export interface FetchKlinesParams {
  symbol: string;
  interval: Interval;
  limit?: number;
  proxyBaseUrl?: string;
  timeoutMs?: number;
}

export function normalizeSymbol(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidSymbol(symbol: string): boolean {
  return /^[A-Z0-9]{4,20}$/.test(symbol);
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after") ?? headers.get("x-retry-after") ?? headers.get("retry-after-ms");
  if (!retryAfter) {
    return undefined;
  }

  const numeric = Number(retryAfter);
  if (Number.isFinite(numeric)) {
    return numeric > 1000 ? numeric : numeric * 1000;
  }

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

function toCandleRow(raw: unknown): CandleRow {
  if (!Array.isArray(raw) || raw.length < 7) {
    throw new BinanceApiError("Invalid candle payload from Binance", { retryable: true });
  }

  const openTimeMs = Number(raw[0]);
  const closeTimeMs = Number(raw[6]);

  return {
    openTimeISO: new Date(openTimeMs).toISOString(),
    openTimeMs,
    open: String(raw[1]),
    high: String(raw[2]),
    low: String(raw[3]),
    close: String(raw[4]),
    volume: String(raw[5]),
    closeTimeISO: new Date(closeTimeMs).toISOString(),
    closeTimeMs,
    quoteVolume: raw[7] != null ? String(raw[7]) : undefined,
    numTrades: raw[8] != null ? Number(raw[8]) : undefined,
    takerBuyBaseVol: raw[9] != null ? String(raw[9]) : undefined,
    takerBuyQuoteVol: raw[10] != null ? String(raw[10]) : undefined
  };
}

export async function fetchKlines(params: FetchKlinesParams): Promise<CandleRow[]> {
  const { symbol, interval, limit = 1000, proxyBaseUrl, timeoutMs = 15000 } = params;
  const baseUrl = (proxyBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const url = new URL(`${baseUrl}/fapi/v1/klines`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      const retryAfterMs = parseRetryAfterMs(response.headers);
      const retryable = response.status === 418 || response.status === 429 || response.status >= 500;
      let detail = "";

      try {
        detail = await response.text();
      } catch {
        detail = "";
      }

      throw new BinanceApiError(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 250)}` : ""}`, {
        status: response.status,
        retryAfterMs,
        retryable
      });
    }

    const json = (await response.json()) as unknown;
    if (!Array.isArray(json)) {
      throw new BinanceApiError("Unexpected Binance response format", { retryable: true });
    }

    return json.map((item) => toCandleRow(item));
  } catch (error) {
    if (error instanceof BinanceApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BinanceApiError("Request timeout", { retryable: true });
    }

    throw new BinanceApiError(error instanceof Error ? error.message : "Network error", { retryable: true });
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateSymbolOnExchange(symbol: string, proxyBaseUrl?: string): Promise<boolean> {
  const baseUrl = (proxyBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const url = new URL(`${baseUrl}/fapi/v1/exchangeInfo`);
  url.searchParams.set("symbol", symbol);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as { symbols?: Array<{ symbol: string; status: string }> };
    const listed = payload.symbols?.find((item) => item.symbol === symbol);
    return Boolean(listed && listed.status === "TRADING");
  } catch {
    return false;
  }
}
