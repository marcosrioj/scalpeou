export const INTERVALS = ["1m", "5m", "15m", "1h", "2h", "4h", "12h", "1w", "1M"] as const;

export type Interval = (typeof INTERVALS)[number];

export type TaskStatus = "pending" | "running" | "retrying" | "done" | "error";

export interface CandleRow {
  openTimeISO: string;
  openTimeMs: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTimeISO: string;
  closeTimeMs: number;
  quoteVolume?: string;
  numTrades?: number;
  takerBuyBaseVol?: string;
  takerBuyQuoteVol?: string;
}

export interface IntervalTaskState {
  status: TaskStatus;
  attempts: number;
  retryAtMs?: number;
  errorMessage?: string;
  count?: number;
}

export interface JobState {
  id: string;
  symbol: string;
  proxyBaseUrl: string;
  autoResume: boolean;
  createdAtISO: string;
  updatedAtISO: string;
  tasks: Record<Interval, IntervalTaskState>;
  data: Partial<Record<Interval, CandleRow[]>>;
  logs: string[];
}
