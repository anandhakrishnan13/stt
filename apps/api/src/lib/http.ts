import { fieldErrors } from "@stt/shared";
import type { z } from "zod";
import { errors } from "./errors";

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw errors.validation(fieldErrors(result.error));
  return result.data;
}
