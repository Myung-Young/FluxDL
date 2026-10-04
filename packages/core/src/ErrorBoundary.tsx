import { Component, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  readonly title: string;
  readonly message: string;
  readonly resetLabel: string;
  /** Changing views remounts the boundary clean (key change resets). */
  readonly resetKey: string;
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly crashed: boolean;
}

/**
 * Per-view crash isolation (F5): a render crash blanks one card with a
 * reload action instead of the whole app. The parent passes the view as
 * resetKey so navigating away and back starts fresh.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { crashed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.crashed) {
      this.setState({ crashed: false });
    }
  }

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="grabber-card" role="alert">
        <h2 className="dl-title">{this.props.title}</h2>
        <p className="muted">{this.props.message}</p>
        <div className="chip-row">
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              this.setState({ crashed: false });
            }}
          >
            {this.props.resetLabel}
          </button>
        </div>
      </div>
    );
  }
}
