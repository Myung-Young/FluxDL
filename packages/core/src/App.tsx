import { useState } from "react";
import { APP_NAME } from "./branding.js";
import "./tokens.css";

export function App(): React.JSX.Element {
  const [url, setUrl] = useState<string>("");
  return (
    <main className="grabber-shell" data-testid="grabber-shell">
      <section className="grabber-card">
        <h1>{APP_NAME}</h1>
        <p>M0 hello window. Engine + queue + screens land in M1–M4.</p>
        <label htmlFor="grabber-url">Video URL</label>
        <input
          id="grabber-url"
          className="grabber-input"
          placeholder="Paste a link…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
          }}
        />
        <p aria-live="polite">{url.length > 0 ? url : "Waiting for a link…"}</p>
        <button className="grabber-button" type="button">
          Analyze
        </button>
      </section>
    </main>
  );
}
