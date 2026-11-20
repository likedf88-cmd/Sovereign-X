import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'Unexpected rendering error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#06080E] text-[#F1F5F9] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#0D121E] border border-white/10 rounded-xl p-8 space-y-4">
            <h2 className="text-xl font-bold font-display text-white">
              Display Recovery Required
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              A component encountered an unexpected state. Reloading restores your session cleanly.
            </p>
            <div className="text-xs font-mono text-amber-300 bg-black/40 border border-white/10 rounded-lg p-3 overflow-auto max-h-36">
              {this.state.message}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
