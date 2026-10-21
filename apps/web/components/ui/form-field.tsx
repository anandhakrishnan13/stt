import type { ReactNode } from "react";
import { Label } from "./label";

export function FormField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id}>{label}</Label>
        {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
