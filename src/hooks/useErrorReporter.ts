'use client';

import { useEffect, useRef } from 'react';

/**
 * Intercepts frontend errors and sends them to the backend error collector via WebSocket.
 * Captures: console.error, window.onerror, unhandledrejection
 */
export function useErrorReporter(send: (type: string, payload?: Record<string, unknown>) => void, connected: boolean) {
  const sendRef = useRef(send);
  sendRef.current = send;
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return;

    const report = (message: string, stack?: string, context?: Record<string, unknown>) => {
      if (!connectedRef.current) return;
      // Skip noise
      if (message.includes('React DevTools') || message.includes('[HMR]') || message.includes('Fast Refresh')) return;
      sendRef.current('error:report', {
        source: 'frontend',
        level: 'error',
        message,
        stack,
        context,
      });
    };

    // Intercept console.error
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      originalError.apply(console, args);
      const message = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      // Don't report our own WS logs or React dev warnings
      if (!message.startsWith('[WS]') && !message.startsWith('[Chat]')) {
        report(message.slice(0, 500));
      }
    };

    // Window error handler
    const onError = (event: ErrorEvent) => {
      report(event.message, event.error?.stack, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };

    // Unhandled promise rejections
    const onRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      report(err.message, err.stack);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      console.error = originalError;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
}
