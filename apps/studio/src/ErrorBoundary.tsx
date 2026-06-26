/**
 * A small render-error boundary. Without one, an uncaught error in any child
 * (e.g. a panel control) unmounts the *entire* React tree — the app goes blank
 * and side effects like the token-file writer get torn down. Wrapping a panel
 * keeps a local crash local: the panel shows a recoverable fallback instead.
 *
 * Reset by changing `resetKey` (e.g. the selected node id) so selecting a
 * different node clears a crash tied to the previous one.
 */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Label for the fallback message (e.g. "Inspector"). */
  label?: string;
  /** Changing this remounts the boundary, clearing the error. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="studio-chrome flex flex-1 flex-col gap-xs p-control text-sm text-ink-dim"
          role="alert"
        >
          <p className="m-0 font-medium text-ink">
            {this.props.label ?? "This panel"} hit an error.
          </p>
          <p className="m-0 text-xs text-ink-faint">
            Select a different node, or reload if it persists.
          </p>
          <pre className="m-0 overflow-auto rounded-sm bg-chrome-2 p-xs text-2xs text-ink-faint">
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
