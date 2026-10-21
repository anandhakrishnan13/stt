import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-10 w-full rounded-md border bg-white px-3 text-sm shadow-xs outline-none transition",
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
  );
});
