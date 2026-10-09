import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Crash report store (Phase 7): opt-in, local-only, never uploaded.
 * The opt-in lives in settings; Shell mirrors it to localStorage (this
 * class component cannot use hooks). Reports cap at 5 × ~2.5 KB.
 */
const CRASH_OPTIN_KEY = "fluxdl-crash-optin";
const CRASH_STORE_KEY = "fluxdl-crashes";
const MAX_CRASHES = 5;

export interface CrashReport {
  readonly t: number;
  readonly view: string;
  readonly message: string;
}

export function isCrashOptIn(): boolean {
  try {
    return localStorage.getItem(CRASH_OPTIN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setCrashOptIn(on: boolean): void {
  try {
    localStorage.setItem(CRASH_OPTIN_KEY, on ? "1" : "0");
  } catch {
    // Private mode etc. — reports simply stay off.
  }
}

export function readCrashReports(): CrashReport[] {
  try {
    const raw = localStorage.getItem(CRASH_STORE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CrashReport[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec["t"] !== "number" || typeof rec["view"] !== "string") continue;
      out.push({
        t: rec["t"],
        view: rec["view"].slice(0, 64),
        message: typeof rec["message"] === "string" ? rec["message"].slice(0, 500) : "",
      });
      if (out.length >= MAX_CRASHES) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function clearCrashReports(): void {
  try {
    localStorage.removeItem(CRASH_STORE_KEY);
  } catch {
    // Already gone.
  }
}

function recordCrash(view: string, message: string): void {
  try {
    if (localStorage.getItem(CRASH_OPTIN_KEY) !== "1") return;
    const next = [
      { t: Date.now(), view: view.slice(0, 64), message: message.slice(0, 500) },
      ...readCrashReports(),
    ].slice(0, MAX_CRASHES);
    localStorage.setItem(CRASH_STORE_KEY, JSON.stringify(next));
  } catch {
    // Storage failure must never break the crash UI itself.
  }
}

export interface ErrorBoundaryProps {
  readonly title: string;
  readonly message: string;
  readonly resetLabel: string;
  /** Changing views remounts the boundary clean (key change resets). */
  readonly resetKey: string;
  /** Last caught crash, surfaced under the message so it is debuggable. */
  readonly detail?: string | null;
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly crashed: boolean;
  readonly detail: string | null;
}

/**
 * Per-view crash isolation (F5): a render crash blanks one card with a
 * reload action instead of the whole app. The parent passes the view as
 * resetKey so navigating away and back starts fresh.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { crashed: false, detail: null };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true, detail: null };
  }

  /**
   * v1.7.2: record the failure instead of dropping it on the floor. The
   * boundary only flipped a flag, so a crashed view showed "This view
   * crashed" with no reason anywhere — not in the console, not in the
   * diagnostics report. The message is shown to the user (it is the only
   * clue they have) and logged for the next report.
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.setState({ detail });
    console.error(`[ErrorBoundary] view=${this.props.resetKey}`, error, info.componentStack);
    recordCrash(this.props.resetKey, detail);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.crashed) {
      this.setState({ crashed: false, detail: null });
    }
  }

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="grabber-card" role="alert">
        <h2 className="dl-title">{this.props.title}</h2>
        <p className="muted">{this.props.message}</p>
        {this.state.detail !== null && (
          <pre className="log-pre" data-testid="crash-detail">
            {this.state.detail}
          </pre>
        )}
        <div className="chip-row">
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              this.setState({ crashed: false, detail: null });
            }}
          >
            {this.props.resetLabel}
          </button>
        </div>
      </div>
    );
  }
}
