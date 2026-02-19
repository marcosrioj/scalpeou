import { useEffect, useMemo, useRef, useState } from "react";
import { isValidSymbol, normalizeSymbol, validateSymbolOnExchange } from "./api/binance";
import { LogPanel } from "./components/LogPanel";
import { ProgressList } from "./components/ProgressList";
import { SettingsAccordion } from "./components/SettingsAccordion";
import { downloadWorkbook } from "./core/excel";
import { TaskRunner } from "./core/taskRunner";
import type { JobState } from "./types";
import { INTERVALS } from "./types";

const SCALP_TYPE_OPTIONS = [
  { value: "none", label: "None (no specific scalp type)" },
  { value: "trend_follow", label: "Trend follow (continuation)" },
  { value: "pullback", label: "Pullback in trend" },
  { value: "breakout", label: "Range breakout" },
  { value: "mean_reversion", label: "Mean reversion" },
  { value: "liquidity_sweep", label: "Liquidity sweep / stop hunt" }
] as const;

function buildResearchPrompt(state: JobState): string {
  const intervalSummary = INTERVALS.map((interval) => {
    const count = state.data[interval]?.length ?? 0;
    return `${interval}: ${count} candles`;
  }).join(", ");

  const available = INTERVALS.filter((interval) => (state.data[interval]?.length ?? 0) > 0).join(", ");

  return `You are a quantitative trading research assistant focused on ultra-short-term (scalp) setups. Your job is to produce a structured list of scalp trade candidates, with explicit uncertainty, estimated probabilities, and clear risk management — strictly for educational purposes, not financial advice.

INPUTS RECEIVED
- Market: ${state.symbol} perpetual futures
- Recent candles (OHLCV) for multiple intervals: ${available || "none"}
- Candle counts by interval: ${intervalSummary}
- Optional: fees, slippage assumptions, timezone, and the exchange session constraints (not provided)
- Optional: my risk constraints (max loss per trade, max leverage, max trades per hour) (not provided)

HARD RULES
- Do NOT claim certainty or “guaranteed” outcomes.
- Probabilities / win-rates must be framed as estimates derived from:
  (a) a described historical backtest on the provided data, OR
  (b) a clearly stated heuristic scoring model.
- If the provided data is insufficient to compute honest probabilities, explicitly say so and output only:
  - setup description,
  - what data you need to estimate probabilities,
  - and a “no probability estimate” marker.

WHAT TO OUTPUT
Produce a concise but information-rich report with:
1) Assumptions
- Fees, slippage, execution latency, and whether signals use closed candles only.

2) Scalp setup list (5–12 items)
For each setup, include:
- Setup name (e.g., “Pullback to VWAP in uptrend”)
- Direction: Long/Short
- Timeframe to execute on (usually 1m; confirmation on 5m/15m)
- Entry trigger (objective, rules-based)
- Invalidation/Stop (objective)
- Targets (TP1/TP2) and rationale
- Estimated probability of success (win-rate %) with:
  - method used (mini-backtest on last N samples OR heuristic score)
  - sample size and limitations
- Expected value or at minimum R:R guidance
- “Why this trade exists” (market structure, volatility regime, momentum/mean reversion)
- Risk notes (news risk, range conditions, spread widening)

3) Regime filter
Explain what market regimes your suggestions assume:
- trending vs ranging
- high vs low volatility
- how you detect regime from candles

4) Safety and execution checklist
A short checklist:
- avoid trading around major macro news
- confirm liquidity/spread
- use limit orders or define slippage assumption
- cap max losses and stop trading after X consecutive losses

SCORING / PROBABILITY GUIDANCE (IF NO FULL BACKTEST)
If you can’t backtest, use a consistent scoring model and map score → probability range:
- Factors (each 0–2 points): higher-timeframe alignment, volatility suitability (ATR), momentum confirmation, key level proximity, signal cleanliness, time-of-day liquidity
- Total score 0–12 → probability bands (example):
  - 10–12: 55–62%
  - 7–9: 50–55%
  - 4–6: 45–50%
  - 0–3: “no edge detected”
Make it clear these are heuristic bands, not guarantees.

FORMAT
- Use a clean table-like markdown structure (no code blocks unless asked).
- Keep each setup brief but complete.
- Use consistent terminology and avoid vague entries like “looks bullish”.

BEGIN by restating the inputs you received and whether they’re sufficient to estimate probabilities.`;
}

function buildQuickScalpPrompt(state: JobState, scalpType: string): string {
  const intervalSummary = INTERVALS.map((interval) => {
    const count = state.data[interval]?.length ?? 0;
    return `${interval}: ${count} candles`;
  }).join(", ");

  const available = INTERVALS.filter((interval) => (state.data[interval]?.length ?? 0) > 0).join(", ");
  const selectedScalpLabel = SCALP_TYPE_OPTIONS.find((option) => option.value === scalpType)?.label ?? scalpType;

  return `You are a crypto scalp analysis assistant for fast output (no backtest).

INPUTS
- Pair: ${state.symbol} perpetual futures
- Available timeframes: ${available || "none"}
- Candle counts: ${intervalSummary}
- Selected scalp type: ${selectedScalpLabel}

TASK
Provide only a quick diagnostic with:
1) Estimated LONG probability (%)
2) Estimated SHORT probability (%)
3) Final bias: LONG, SHORT, or NEUTRAL
4) Short rationale (3-5 objective bullets)

MANDATORY RULES
- Do not use backtests and do not cite historical win rate.
- Probabilities must be heuristic and sum to 100%.
- Base the response on structure, momentum, volatility, and candle context.
- Validate Squeeze Pro on every selected setup and report:
  - active squeeze: YES/NO
  - identified side: BUYERS / SELLERS / INCONCLUSIVE
  - squeeze timeframes: list exact timeframes where squeeze is present (e.g., 1m, 5m, 15m); if none, state NONE
  - for each timeframe with squeeze, include the exact timestamp(s) as YYYY-MM-DD HH:mm (at least minute precision)
- If data is insufficient, keep the same output format and mark confidence as low.

OUTPUT FORMAT
- Prob. LONG: X%
- Prob. SHORT: Y%
- Bias: LONG | SHORT | NEUTRAL
- Squeeze Pro: active (YES/NO), side (BUYERS/SELLERS/INCONCLUSIVE), timeframes (list or NONE), timestamps (YYYY-MM-DD HH:mm per timeframe)
- Quick read:
  - bullet 1
  - bullet 2
  - bullet 3`;
}

export default function App() {
  const [symbolInput, setSymbolInput] = useState("BTCUSDT");
  const [proxyBaseUrl, setProxyBaseUrl] = useState("");
  const [autoResume, setAutoResume] = useState(true);
  const [state, setState] = useState<JobState | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationMsg, setValidationMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [copyMsg, setCopyMsg] = useState("");
  const [copyQuickMsg, setCopyQuickMsg] = useState("");
  const [selectedScalpType, setSelectedScalpType] = useState("none");

  const runnerRef = useRef<TaskRunner | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const runner = new TaskRunner({
      onStateChange: (nextState) => {
        setState(nextState ?? null);
      }
    });
    runnerRef.current = runner;

    runner
      .resumeIfNeeded()
      .then(async () => {
        const current = runner.getState();
        if (!current) {
          return;
        }

        setProxyBaseUrl(current.proxyBaseUrl);
        setAutoResume(current.autoResume);
        setSymbolInput(current.symbol);
      })
      .catch(() => {
        setValidationMsg("Failed to load saved job state.");
      });

    return () => {
      runnerRef.current = null;
    };
  }, []);

  const symbol = useMemo(() => normalizeSymbol(symbolInput), [symbolInput]);

  const completedCount = state ? INTERVALS.filter((it) => state.tasks[it].status === "done").length : 0;
  const allCompleted = completedCount === INTERVALS.length;
  const anyCompleted = completedCount > 0;
  const researchPrompt = state ? buildResearchPrompt(state) : "";
  const quickScalpPrompt = state ? buildQuickScalpPrompt(state, selectedScalpType) : "";

  async function handleValidateSymbol() {
    const normalized = normalizeSymbol(symbolInput);
    setValidationMsg("");

    if (!isValidSymbol(normalized)) {
      setValidationMsg("Symbol format invalid. Use A-Z0-9, 4-20 chars.");
      return;
    }

    setValidating(true);
    const ok = await validateSymbolOnExchange(normalized, proxyBaseUrl.trim());
    setValidating(false);
    setValidationMsg(ok ? "Symbol is valid and trading on USD-M Futures." : "Symbol not found/trading (or blocked by CORS). You can still try fetching.");
  }

  async function handleStart() {
    const runner = runnerRef.current;
    if (!runner) {
      return;
    }

    const normalized = normalizeSymbol(symbolInput);
    if (!isValidSymbol(normalized)) {
      setValidationMsg("Symbol format invalid. Use A-Z0-9, 4-20 chars.");
      return;
    }

    setValidationMsg("");
    setBusy(true);

    try {
      await runner.startNewJob({
        symbol: normalized,
        proxyBaseUrl: proxyBaseUrl.trim(),
        autoResume
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSettings(nextProxy?: string, nextAuto?: boolean) {
    const runner = runnerRef.current;
    if (!runner) {
      return;
    }

    await runner.updateSettings({
      proxyBaseUrl: nextProxy ?? proxyBaseUrl,
      autoResume: nextAuto ?? autoResume
    });
  }

  async function handleReset() {
    const runner = runnerRef.current;
    if (!runner) {
      return;
    }

    await runner.clearSavedState();
    setState(null);
    setValidationMsg("Cleared saved job state.");
  }

  function handleDownloadPartial() {
    if (!state) {
      return;
    }

    downloadWorkbook(state);
  }

  async function handleCopyPrompt() {
    if (!researchPrompt) {
      return;
    }

    try {
      await navigator.clipboard.writeText(researchPrompt);
      setCopyMsg("Prompt copied.");
      window.setTimeout(() => setCopyMsg(""), 1800);
    } catch {
      setCopyMsg("Failed to copy prompt.");
      window.setTimeout(() => setCopyMsg(""), 1800);
    }
  }

  async function handleCopyQuickPrompt() {
    if (!quickScalpPrompt) {
      return;
    }

    try {
      await navigator.clipboard.writeText(quickScalpPrompt);
      setCopyQuickMsg("Quick prompt copied.");
      window.setTimeout(() => setCopyQuickMsg(""), 1800);
    } catch {
      setCopyQuickMsg("Failed to copy quick prompt.");
      window.setTimeout(() => setCopyQuickMsg(""), 1800);
    }
  }

  return (
    <main className="container">
      <h1>Binance Futures Kline Excel Builder</h1>

      <section className="panel controls">
        <label>
          Symbol
          <input
            value={symbolInput}
            onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
            placeholder="BTCUSDT"
            disabled={busy}
          />
        </label>

        <div className="button-row">
          <button onClick={handleStart} disabled={busy}>
            {busy ? "Running..." : "Fetch & Build Excel"}
          </button>
          <button onClick={handleValidateSymbol} disabled={validating || busy}>
            {validating ? "Validating..." : "Validate symbol"}
          </button>
          <button
            onClick={handleDownloadPartial}
            disabled={!state || !anyCompleted}
            title={allCompleted ? "All intervals complete" : "Partial download: some intervals are not finished"}
          >
            {allCompleted ? "Download Excel" : "Download partial Excel"}
          </button>
          <button onClick={handleReset}>Reset job / clear saved state</button>
        </div>

        {validationMsg ? <p className="note">{validationMsg}</p> : null}
        <p className="note">Normalized symbol: {symbol}</p>
      </section>

      <SettingsAccordion
        proxyBaseUrl={proxyBaseUrl}
        autoResume={autoResume}
        onProxyChange={(value) => {
          setProxyBaseUrl(value);
          void handleSaveSettings(value, undefined);
        }}
        onAutoResumeChange={(value) => {
          setAutoResume(value);
          void handleSaveSettings(undefined, value);
        }}
      />

      {state ? <ProgressList state={state} nowMs={nowMs} /> : null}
      {state ? <LogPanel logs={state.logs} /> : null}
      {state && anyCompleted ? (
        <section className="panel">
          <h2>Prompt (customized for Pair)</h2>
          <div className="button-row">
            <button onClick={handleCopyPrompt}>Copy prompt</button>
            {copyMsg ? <span className="note">{copyMsg}</span> : null}
          </div>
          <textarea className="prompt-box" value={researchPrompt} readOnly />

          <h2>Quick Scalp Prompt (no backtest)</h2>
          <label>
            Scalp type
            <select value={selectedScalpType} onChange={(event) => setSelectedScalpType(event.target.value)}>
              {SCALP_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button onClick={handleCopyQuickPrompt} disabled={!quickScalpPrompt}>
              Copy quick prompt
            </button>
            {copyQuickMsg ? <span className="note">{copyQuickMsg}</span> : null}
          </div>
          <textarea
            className="prompt-box prompt-box-compact"
            value={quickScalpPrompt || "Select a scalp type to generate a quick long/short probability prompt."}
            readOnly
          />
        </section>
      ) : null}

      <footer className="footer">
        <span>Intervals: {INTERVALS.join(", ")}</span>
      </footer>
    </main>
  );
}
