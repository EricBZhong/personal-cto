'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToastStore } from '@/stores/toast-store';

const typeStyles: Record<string, string> = {
  success: 'border-l-emerald-500 bg-emerald-500/10 ring-emerald-500/20',
  error: 'border-l-red-500 bg-red-500/10 ring-red-500/20',
  warning: 'border-l-amber-500 bg-amber-500/10 ring-amber-500/20',
  info: 'border-l-blue-500 bg-blue-500/10 ring-blue-500/20',
};

const typeTextColor: Record<string, string> = {
  success: 'text-emerald-300',
  error: 'text-red-300',
  warning: 'text-amber-300',
  info: 'text-blue-300',
};

function ToastIcon({ type }: { type: string }) {
  const className = `w-4 h-4 flex-shrink-0 ${typeTextColor[type] || typeTextColor.info}`;

  switch (type) {
    case 'success':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'error':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'warning':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      );
    default: // info
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
  }
}

function ToastItem({ toast, onRemove }: { toast: { id: string; type: string; message: string }; onRemove: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 250);
  }, [toast.id, onRemove]);

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border-l-4 ring-1 backdrop-blur-md shadow-lg shadow-black/20 ${
        isExiting ? 'animate-slide-out-right' : 'animate-slide-in-right'
      } ${typeStyles[toast.type] || typeStyles.info}`}
      style={{ minWidth: 300, maxWidth: 420 }}
    >
      <ToastIcon type={toast.type} />
      <span className={`text-sm flex-1 leading-relaxed ${typeTextColor[toast.type] || typeTextColor.info}`}>
        {toast.message}
      </span>
      <button
        onClick={handleDismiss}
        className="text-zinc-500 hover:text-zinc-300 transition-colors duration-200 flex-shrink-0 mt-0.5"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}
