export function LogPanel({ logs }: { logs: string[] }) {
  return (
    <div className="panel">
      <h2>Logs (last 50)</h2>
      <div className="logs">
        {logs.length === 0 ? <p className="muted">No logs yet.</p> : null}
        {logs.map((line, idx) => (
          <div key={`${line}-${idx}`} className="log-line">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
