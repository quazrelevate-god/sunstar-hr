import { Component } from "react";
import type { ReactNode } from "react";

/** Last-resort catch so a render crash shows a reload screen, not a white page. */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Sunstar HR crashed:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 max-w-md text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <div className="text-lg font-bold text-gray-900">Something went wrong</div>
          <div className="text-sm text-gray-500">
            The page hit an unexpected error. Your submitted data is safe on the server.
          </div>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-xl"
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
