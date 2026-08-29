'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface ModuleErrorBoundaryProps {
  children: ReactNode;
  moduleName?: string;
}

interface ModuleErrorBoundaryState {
  hasError: boolean;
}

/**
 * Keeps a malformed module response or a lazy-loaded module from taking down
 * the whole shell. The module is remounted on retry; navigation also remounts
 * it because page.tsx supplies a route-specific key.
 */
export default class ModuleErrorBoundary extends Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  state: ModuleErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ModuleErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ModuleErrorBoundary]', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <section className="flex h-full min-h-0 items-center justify-center p-8 text-center">
        <div className="glass-panel max-w-md rounded-2xl border border-status-failed-border p-8">
          <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-status-failed-fg">
            MODULE ERROR
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            {this.props.moduleName || '此模块'}加载失败
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            页面数据异常或模块暂时不可用。可以重试当前模块，不会影响其他页面。
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-accent hover:bg-primary-hover"
          >
            重试
          </button>
        </div>
      </section>
    );
  }
}
