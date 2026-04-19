import { create } from 'zustand';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  createdAt: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (type: Toast['type'], message: string) => void;
  removeToast: (id: string) => void;
}

let nextId = 0;
const timerMap = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  addToast: (type, message) => {
    const id = `toast-${++nextId}`;
    const toast: Toast = { id, type, message, createdAt: Date.now() };

    set((state) => {
      // Max 3 visible — drop oldest; clean up timers for evicted toasts
      const combined = [...state.toasts, toast];
      const evicted = combined.slice(0, Math.max(0, combined.length - 3));
      for (const e of evicted) {
        const timer = timerMap.get(e.id);
        if (timer) {
          clearTimeout(timer);
          timerMap.delete(e.id);
        }
      }
      return { toasts: combined.slice(-3) };
    });

    // Auto-dismiss after 5s
    const timer = setTimeout(() => {
      timerMap.delete(id);
      get().removeToast(id);
    }, 5000);
    timerMap.set(id, timer);
  },

  removeToast: (id) => {
    // Clear auto-dismiss timer on manual remove to prevent stale callbacks
    const timer = timerMap.get(id);
    if (timer) {
      clearTimeout(timer);
      timerMap.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));
