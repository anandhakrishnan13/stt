import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError } from "./api";

/**
 * Pushes API field errors into react-hook-form, returning a form-level message
 * when the error is not field-specific.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): string | null {
  if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
    const details = error.details;
    if (details && typeof details === "object") {
      const entries = Object.entries(details);
      let applied = false;
      for (const [field, message] of entries) {
        if (typeof message !== "string") continue;
        setError(field as Path<T>, { type: "server", message });
        applied = true;
      }
      if (applied) return null;
    }
    return error.message;
  }

  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Try again";
}
