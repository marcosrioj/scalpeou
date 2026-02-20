import { useState } from "react";

interface SettingsProps {
  proxyBaseUrl: string;
  autoResume: boolean;
  timezone: string;
  onProxyChange: (value: string) => void;
  onAutoResumeChange: (value: boolean) => void;
  onTimezoneChange: (value: string) => void;
}

export function SettingsAccordion(props: SettingsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="panel">
      <button className="accordion-toggle" onClick={() => setOpen((value) => !value)}>
        Settings {open ? "▲" : "▼"}
      </button>

      {open ? (
        <div className="settings-grid">
          <label>
            Proxy Base URL
            <input
              value={props.proxyBaseUrl}
              onChange={(event) => props.onProxyChange(event.target.value)}
              placeholder="https://your-proxy.example.com"
            />
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={props.autoResume}
              onChange={(event) => props.onAutoResumeChange(event.target.checked)}
            />
            Resume unfinished job automatically
          </label>

          <label>
            Timezone (IANA)
            <input
              value={props.timezone}
              onChange={(event) => props.onTimezoneChange(event.target.value)}
              placeholder="America/Vancouver"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
