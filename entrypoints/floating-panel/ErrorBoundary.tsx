import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { failed: boolean };

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ChartViz panel render failed', error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <div className="fatal-error-card">
          <div className="fatal-error-logo">CV</div>
          <h1>ChartViz</h1>
          <p>结果显示失败，请重新加载插件。</p>
          <p>ChartViz could not display this result. Reload the extension and try again.</p>
          <button type="button" onClick={() => location.reload()}>重新加载 · Reload</button>
        </div>
      </main>
    );
  }
}
