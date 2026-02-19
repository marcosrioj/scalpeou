import { useEffect, useMemo, useRef, useState } from "react";
import { isValidSymbol, normalizeSymbol, validateSymbolOnExchange } from "./api/binance";
import { LogPanel } from "./components/LogPanel";
import { ProgressList } from "./components/ProgressList";
import { SettingsAccordion } from "./components/SettingsAccordion";
import { downloadWorkbook } from "./core/excel";
import { TaskRunner } from "./core/taskRunner";
import type { JobState } from "./types";
import { INTERVALS } from "./types";

export default function App() {
  const [symbolInput, setSymbolInput] = useState("BTCUSDT");
  const [proxyBaseUrl, setProxyBaseUrl] = useState("");
  const [autoResume, setAutoResume] = useState(true);
  const [state, setState] = useState<JobState | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationMsg, setValidationMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

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

      <footer className="footer">
        <span>Intervals: {INTERVALS.join(", ")}</span>
      </footer>
    </main>
  );
}
