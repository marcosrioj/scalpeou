import type { Interval, JobState } from "../types";
import { INTERVALS } from "../types";

const statusColor: Record<string, string> = {
  pending: "#71717a",
  running: "#0284c7",
  retrying: "#ea580c",
  done: "#16a34a",
  error: "#dc2626"
};

function label(state: JobState, interval: Interval, nowMs: number): string {
  const task = state.tasks[interval];
  if (task.status === "retrying" && task.retryAtMs) {
    const seconds = Math.max(0, Math.ceil((task.retryAtMs - nowMs) / 1000));
    return `Waiting to retry in ${seconds}s...`;
  }

  if (task.status === "done") {
    return `Done (${task.count ?? 0} candles)`;
  }

  if (task.status === "error") {
    return `Error: ${task.errorMessage ?? "Unknown"}`;
  }

  return task.status;
}

export function ProgressList({ state, nowMs }: { state: JobState; nowMs: number }) {
  return (
    <div className="panel">
      <h2>Interval Progress</h2>
      <ul className="progress-list">
        {INTERVALS.map((interval) => {
          const task = state.tasks[interval];
          const color = statusColor[task.status] || "#71717a";

          return (
            <li key={interval} className="progress-item">
              <span className="interval">{interval}</span>
              <span style={{ color }}>{label(state, interval, nowMs)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
