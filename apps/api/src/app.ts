import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { corsOrigins } from "./env";
import { limits } from "./lib/limits";
import { AppError, errors } from "./lib/errors";
import { authRoutes } from "./routes/auth";
import { passwordRoutes } from "./routes/password";

function httpStatus(error: unknown): number {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const value = error.statusCode;
    if (typeof value === "number") return value;
  }
  return 500;
}

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"), false);
    },
    credentials: true,
  });
  await app.register(rateLimit, {
    global: true,
    max: limits.global.max,
    timeWindow: limits.global.timeWindow,
    errorResponseBuilder: (_request, context) => ({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Try again shortly",
        details: { retryAfterSeconds: Math.ceil(context.ttl / 1000) },
      },
    }),
  });

  // CSRF defence in depth: cookies are SameSite=Lax, and state-changing
  // requests that declare an Origin must come from an allowed one.
  app.addHook("onRequest", async (request) => {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
    const origin = request.headers.origin;
    if (origin && !corsOrigins.includes(origin)) throw errors.csrf();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Check the highlighted fields",
          details: error.issues,
        },
      });
    }

    const status = httpStatus(error);

    if (status === 429) {
      return reply.code(429).send({
        error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly" },
      });
    }

    if (status >= 400 && status < 500) {
      const message = error instanceof Error ? error.message : "Request failed";
      return reply
        .code(status)
        .send({ error: { code: "VALIDATION_ERROR", message } });
    }

    request.log.error(error);
    return reply
      .code(500)
      .send({ error: { code: "INTERNAL", message: "Something went wrong" } });
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(passwordRoutes, { prefix: "/auth" });

  return app;
}
