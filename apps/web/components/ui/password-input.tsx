"use client";

import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type PasswordInputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className, invalid, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-10 w-full rounded-md border bg-white pl-3 pr-10 text-sm shadow-xs outline-none transition",
          "placeholder:text-slate-400",
          "focus:border-slate-500 focus:ring-2 focus:ring-slate-200",
          "dark:bg-slate-900 dark:focus:ring-slate-800",
          invalid
            ? "border-red-500 focus:border-red-500 focus:ring-red-200 dark:focus:ring-red-900"
            : "border-slate-300 dark:border-slate-700",
          className,
        )}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-0 top-0 flex h-10 w-10 cursor-pointer items-center justify-center text-slate-400 transition hover:text-slate-600 focus:outline-none dark:hover:text-slate-200"
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
});
