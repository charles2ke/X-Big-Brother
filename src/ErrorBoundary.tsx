import { Component, Fragment } from 'react'
import type { ReactNode } from 'react'

interface State { failed: boolean; attempt: number }

/** Replaces a crashed dashboard with a way back, instead of leaving a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, attempt: 0 }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  // A new key remounts the dashboard with fresh state, which also re-reads device data.
  reload = () => this.setState(state => ({ failed: false, attempt: state.attempt + 1 }))

  render() {
    if (this.state.failed) {
      return <div className="crash" role="alert">
        <strong>Something went wrong</strong>
        <p>The dashboard hit an unexpected error. Reloading starts it fresh; no error details leave this device.</p>
        {/* The focused control vanished with the dashboard, so keyboard users land on the way back. */}
        <button className="primary" autoFocus onClick={this.reload}>Reload dashboard</button>
      </div>
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}
