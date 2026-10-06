import { Component, type ErrorInfo, type ReactNode } from "react";

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
