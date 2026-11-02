import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangleIcon, RotateCcwIcon, ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, SparklesIcon, HouseIcon } from 'lucide-react';
import { Button } from './Button';
import { isStaleBuild, shouldResetBoundary, supportDetails } from '../../utils/pageErrors';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
  /**
   * 'page': one page inside the shell broke; the menu and top bar keep working, and "Go to Home" is offered.
   * Left out: the last line of defence (or a part of a page), with "Back to agents".
   */
  variant?: 'page';
  /** When it changes (another page is opened), whatever broke is drawn again. */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public override componentDidUpdate(previous: Props) {
    if (shouldResetBoundary(this.state.hasError, previous.resetKey, this.props.resetKey)) {
      this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false, copied: false });
    }
  }

  private handleReset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
  };

  private copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(supportDetails(this.state.error, window.location.href, new Date()));
      this.setState({ copied: true });
    } catch {
      this.setState({ copied: false });
    }
  };

  public override render() {
    if (this.state.hasError) {
      const stale = isStaleBuild(this.state.error);
      const page = this.props.variant === 'page';
      const title = stale
        ? 'A new version of Weave Studio is available'
        : this.props.fallbackTitle ?? (page ? 'This page couldn’t be shown' : 'Something unexpected went wrong');
      const text = stale
        ? 'Weave Studio was updated while this tab was open. Reload to continue; your saved work is kept.'
        : page
          ? 'Something went wrong while showing it. The rest of Weave Studio still works, and your saved work is kept.'
          : this.state.error?.message || 'An error occurred while rendering this component.';
      return (
        <div className="mx-auto my-8 max-w-xl rounded-xl border border-danger/30 bg-surface p-6 shadow-panel" role="alert">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
              {stale ? <SparklesIcon className="h-5 w-5" aria-hidden /> : <AlertTriangleIcon className="h-5 w-5" aria-hidden />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-ink">{title}</h2>
              <p className="mt-1 text-sm text-muted">{text}</p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {stale ? (
                  <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
                    <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden />
                    Reload
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={this.handleReset}>
                    <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden />
                    Try again
                  </Button>
                )}
                {page ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      window.location.href = '/';
                    }}
                  >
                    <HouseIcon className="h-3.5 w-3.5" aria-hidden />
                    Go to Home
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      window.location.href = '/agents';
                    }}
                  >
                    <ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden />
                    Back to agents
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
                  aria-expanded={this.state.showDetails}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
                >
                  {this.state.showDetails ? (
                    <>
                      Hide details <ChevronUpIcon className="h-3 w-3" aria-hidden />
                    </>
                  ) : (
                    <>
                      View details <ChevronDownIcon className="h-3 w-3" aria-hidden />
                    </>
                  )}
                </button>
              </div>

              {this.state.showDetails && (
                <div className="mt-4 rounded-lg bg-canvas p-3 font-mono text-xs text-ink-soft overflow-x-auto border border-line">
                  <p className="font-semibold text-danger">{this.state.error?.toString()}</p>
                  {this.state.errorInfo?.componentStack && (
                    <pre className="mt-2 text-[11px] leading-relaxed opacity-80 whitespace-pre-wrap">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                  <button
                    type="button"
                    onClick={() => void this.copyDetails()}
                    className="mt-2 inline-flex items-center gap-1 font-sans text-xs font-medium text-accent hover:underline"
                  >
                    <CopyIcon className="h-3 w-3" aria-hidden />
                    {this.state.copied ? 'Copied' : 'Copy details for support'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
