import { useState } from "react";
import { Shell } from "./Shell.js";
import type { DownloadEngine } from "./engine.js";

function getEngine(): DownloadEngine | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { grabber?: DownloadEngine };
  return w.grabber ?? null;
}

export function App(): React.JSX.Element {
  const [engine] = useState<DownloadEngine | null>(getEngine);
  if (engine === null) {
    return (
      <main style={{ padding: 32 }}>
        <h1>Unavailable</h1>
        <p>This UI must run inside the desktop shell.</p>
      </main>
    );
  }
  return <Shell engine={engine} />;
}
