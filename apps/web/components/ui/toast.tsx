"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ToastType = "info" | "success" | "error";

type Toast = {
  id: string;
  message: string;
  type?: ToastType;
  duration?: number;
};

type ToastContextValue = {
  toast: (message: string, type?: ToastType, duration?: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let globalToast: ((message: string, type?: ToastType, duration?: number) => void) | null = null;

export function showToast(message: string, type: ToastType = "info", duration = 4000) {
  if (globalToast) {
    globalToast(message, type, duration);
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (message: string, type: ToastType = "info", duration = 4000) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  };

  useEffect(() => {
    globalToast = addToast;
    return () => {
      globalToast = null;
    };
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.duration || 4000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-auto flex items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-lg transition-all",
        "border-slate-200 bg-white text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100",
      )}
    >
      <div className="flex items-center gap-2.5 text-sm">
        {toast.type === "error" ? (
          <AlertCircle className="size-4 shrink-0 text-rose-500" />
        ) : toast.type === "success" ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
        ) : (
          <Info className="size-4 shrink-0 text-sky-500" />
        )}
        <span>{toast.message}</span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="cursor-pointer rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        aria-label="Dismiss notification"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
