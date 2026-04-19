'use client';

import { useEffect } from 'react';

interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
  autoClose?: number; // ms, default 10000
}

export function ErrorBanner({ message, onDismiss, autoClose = 10000 }: ErrorBannerProps) {
  useEffect(() => {
    if (!onDismiss || !autoClose) return;
    const timer = setTimeout(onDismiss, autoClose);
    return () => clearTimeout(timer);
  }, [onDismiss, autoClose, message]);

  return (
    <div className="mx-5 mt-2.5 px-3.5 py-2.5 bg-red-900/20 ring-1 ring-red-800/40 rounded-xl flex items-center justify-between text-xs text-red-300 animate-fade-in-up">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <span>{message}</span>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="ml-3 text-red-400/70 hover:text-red-300 transition-colors duration-200 flex-shrink-0 font-medium">
          dismiss
        </button>
      )}
    </div>
  );
}
