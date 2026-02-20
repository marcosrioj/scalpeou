import { fetchKlines, type BinanceApiError } from "../api/binance";
import { storage } from "./storage";
import type { CandleRow, Interval, IntervalTaskState, JobState, TaskStatus } from "../types";
import { DEFAULT_TIMEZONE, INTERVALS } from "../types";

const MAX_LOGS = 50;
const MAX_BACKOFF_MS = 60_000;

interface RunnerCallbacks {
  onStateChange?: (state: JobState | null) => void;
}

export interface StartJobOptions {
  symbol: string;
  proxyBaseUrl: string;
  autoResume: boolean;
  timezone: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function initialTaskState(): Record<Interval, IntervalTaskState> {
  return INTERVALS.reduce(
    (acc, interval) => {
      acc[interval] = { status: "pending", attempts: 0 };
      return acc;
    },
    {} as Record<Interval, IntervalTaskState>
  );
}

function isRetryable(error: unknown): error is BinanceApiError {
  return typeof error === "object" && error !== null && "retryable" in error && Boolean((error as BinanceApiError).retryable);
}

function formatLog(message: string): string {
  return `${new Date().toISOString()} ${message}`;
}

function withLog(state: JobState, message: string): JobState {
  const logs = [...state.logs, formatLog(message)].slice(-MAX_LOGS);
  return { ...state, logs, updatedAtISO: nowIso() };
}

function isFinishedStatus(status: TaskStatus): boolean {
  return status === "done" || status === "error";
}

function computeRetryDelayMs(attempts: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_BACKOFF_MS);
  }

  const exponential = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 8));
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(MAX_BACKOFF_MS, exponential + jitter);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class TaskRunner {
  private state: JobState | null = null;
  private callbacks: RunnerCallbacks;
  private active = false;

  constructor(callbacks?: RunnerCallbacks) {
    this.callbacks = callbacks ?? {};
  }

  getState(): JobState | null {
    return this.state;
  }

  private async persistAndEmit(state: JobState): Promise<void> {
    this.state = state;
    await storage.set(state);
    this.callbacks.onStateChange?.(state);
  }

  private async setState(mutator: (previous: JobState) => JobState): Promise<void> {
    if (!this.state) {
      return;
    }

    const next = mutator(this.state);
    await this.persistAndEmit(next);
  }

  async loadSavedState(): Promise<JobState | null> {
    const saved = await storage.get();
    if (!saved) {
      this.state = null;
      return null;
    }

    const withDefaults: JobState = {
      ...saved,
      timezone: saved.timezone || DEFAULT_TIMEZONE
    };

    this.state = withDefaults;
    this.callbacks.onStateChange?.(withDefaults);
    return withDefaults;
  }

  async startNewJob(options: StartJobOptions): Promise<void> {
    const state: JobState = {
      id: crypto.randomUUID(),
      symbol: options.symbol,
      proxyBaseUrl: options.proxyBaseUrl,
      autoResume: options.autoResume,
      timezone: options.timezone || DEFAULT_TIMEZONE,
      createdAtISO: nowIso(),
      updatedAtISO: nowIso(),
      tasks: initialTaskState(),
      data: {},
      logs: []
    };

    await this.persistAndEmit(withLog(state, `Started job for ${options.symbol}`));
    await this.run();
  }

  async updateSettings(settings: Partial<Pick<StartJobOptions, "proxyBaseUrl" | "autoResume" | "timezone">>): Promise<void> {
    if (!this.state) {
      return;
    }

    await this.setState((prev) => ({
      ...prev,
      proxyBaseUrl: settings.proxyBaseUrl ?? prev.proxyBaseUrl,
      autoResume: settings.autoResume ?? prev.autoResume,
      timezone: settings.timezone ?? prev.timezone,
      updatedAtISO: nowIso()
    }));
  }

  async clearSavedState(): Promise<void> {
    this.active = false;
    this.state = null;
    await storage.clear();
    this.callbacks.onStateChange?.(null);
  }

  async resumeIfNeeded(): Promise<void> {
    const saved = await this.loadSavedState();
    if (!saved) {
      return;
    }

    const unfinished = INTERVALS.some((interval) => !isFinishedStatus(saved.tasks[interval].status));
    if (saved.autoResume && unfinished) {
      await this.setState((prev) => withLog(prev, "Resuming unfinished job"));
      await this.run();
    }
  }

  private async run(): Promise<void> {
    if (!this.state || this.active) {
      return;
    }

    this.active = true;

    try {
      for (const interval of INTERVALS) {
        if (!this.state) {
          break;
        }

        const current = this.state.tasks[interval];
        if (current.status === "done") {
          continue;
        }

        if (current.status === "error") {
          continue;
        }

        await this.executeInterval(interval);
      }
    } finally {
      this.active = false;
    }
  }

  private async executeInterval(interval: Interval): Promise<void> {
    while (this.state) {
      const task = this.state.tasks[interval];
      if (task.status === "done" || task.status === "error") {
        return;
      }

      if (task.status === "retrying" && task.retryAtMs && task.retryAtMs > Date.now()) {
        await delay(task.retryAtMs - Date.now());
      }

      await this.setState((prev) => ({
        ...prev,
        tasks: {
          ...prev.tasks,
          [interval]: {
            ...prev.tasks[interval],
            status: "running",
            retryAtMs: undefined,
            errorMessage: undefined
          }
        },
        updatedAtISO: nowIso()
      }));

      try {
        const candles = await fetchKlines({
          symbol: this.state.symbol,
          interval,
          limit: 1000,
          proxyBaseUrl: this.state.proxyBaseUrl
        });

        await this.onIntervalSuccess(interval, candles);
        return;
      } catch (error) {
        if (isRetryable(error)) {
          const attempts = (this.state.tasks[interval].attempts ?? 0) + 1;
          const waitMs = computeRetryDelayMs(attempts, error.retryAfterMs);
          await this.onIntervalRetry(interval, attempts, waitMs, error.message);
          await delay(waitMs);
          continue;
        }

        const message = error instanceof Error ? error.message : "Unknown error";
        await this.setState((prev) =>
          withLog(
            {
              ...prev,
              tasks: {
                ...prev.tasks,
                [interval]: {
                  ...prev.tasks[interval],
                  status: "error",
                  errorMessage: message
                }
              }
            },
            `${interval} failed permanently: ${message}`
          )
        );
        return;
      }
    }
  }

  private async onIntervalSuccess(interval: Interval, candles: CandleRow[]): Promise<void> {
    await this.setState((prev) =>
      withLog(
        {
          ...prev,
          data: {
            ...prev.data,
            [interval]: candles
          },
          tasks: {
            ...prev.tasks,
            [interval]: {
              ...prev.tasks[interval],
              status: "done",
              count: candles.length,
              retryAtMs: undefined,
              errorMessage: candles.length < 1000 ? "Returned fewer than 1000 candles" : undefined
            }
          }
        },
        `${interval} completed with ${candles.length} candles`
      )
    );
  }

  private async onIntervalRetry(interval: Interval, attempts: number, waitMs: number, errorMessage: string): Promise<void> {
    const retryAtMs = Date.now() + waitMs;
    const waitSec = Math.ceil(waitMs / 1000);

    await this.setState((prev) =>
      withLog(
        {
          ...prev,
          tasks: {
            ...prev.tasks,
            [interval]: {
              ...prev.tasks[interval],
              status: "retrying",
              attempts,
              retryAtMs,
              errorMessage
            }
          }
        },
        `${interval} transient error. Waiting ${waitSec}s before retry: ${errorMessage}`
      )
    );
  }
}
