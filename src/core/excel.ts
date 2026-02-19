import * as XLSX from "xlsx";
import { INTERVALS } from "../types";
import type { Interval, JobState } from "../types";

function toRows(state: JobState, interval: Interval) {
  return state.data[interval] ?? [];
}

function formatTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

export function buildWorkbook(state: JobState): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  for (const interval of INTERVALS) {
    const rows = toRows(state, interval);
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, interval);
  }

  const intervalsSucceeded = INTERVALS.filter((it) => state.tasks[it].status === "done");
  const intervalsFailed = INTERVALS.filter((it) => state.tasks[it].status === "error");
  const notes = INTERVALS.flatMap((it) => {
    const task = state.tasks[it];
    if (task.errorMessage && task.status === "done") {
      return [`${it}: ${task.errorMessage}`];
    }
    return [];
  });

  const metaSheet = XLSX.utils.json_to_sheet([
    {
      symbol: state.symbol,
      generatedAtISO: new Date().toISOString(),
      intervalsRequested: INTERVALS.join(", "),
      intervalsSucceeded: intervalsSucceeded.join(", "),
      intervalsFailed: intervalsFailed.join(", "),
      notes: notes.join(" | ")
    }
  ]);

  XLSX.utils.book_append_sheet(wb, metaSheet, "meta");
  return wb;
}

export function suggestedFileName(symbol: string): string {
  return `${symbol}_futures_klines_1000_${formatTimestamp()}.xlsx`;
}

export function downloadWorkbook(state: JobState): void {
  const wb = buildWorkbook(state);
  const fileName = suggestedFileName(state.symbol);
  XLSX.writeFile(wb, fileName);
}
