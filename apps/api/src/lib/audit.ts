import { db } from "../db";
import { auditEvents } from "../db/schema";

export async function recordAudit(input: {
  action: string;
  actorUserId?: string | null;
  target?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      target: input.target ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (error) {
    // Audit must never break the request path.
    console.error("[audit] failed to record", input.action, error);
  }
}
