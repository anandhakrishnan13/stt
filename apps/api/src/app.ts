import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { corsOrigins, env } from "./env";
import { limits } from "./lib/limits";
import { AppError, errors } from "./lib/errors";
import { authRoutes } from "./routes/auth";
import { passwordRoutes } from "./routes/password";
import { streamRoutes } from "./routes/stream";
import { transcriptRoutes } from "./routes/transcripts";

function httpStatus(error: unknown): number {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const value = error.statusCode;
    if (typeof value === "number") return value;
  }
  return 500;
}

export function buildApp(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
  });
  const allowedOrigins = corsOrigins();

  app.register(helmet, { contentSecurityPolicy: false });
  app.register(websocket, {
    options: { maxPayload: 1024 * 1024 },
  });
  app.register(cookie);
  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"],
  });
  app.register(rateLimit, {
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

  // Raw audio chunks: one request per second while recording, so buffers stay small.
  // Raw audio chunks & uploaded files: parsed as binary buffer up to MAX_AUDIO_BYTES
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: env.MAX_AUDIO_BYTES },
    (_request, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    /^audio\/.+/,
    { parseAs: "buffer", bodyLimit: env.MAX_AUDIO_BYTES },
    (_request, body, done) => done(null, body),
  );

  // CSRF defence in depth: cookies are SameSite=Lax, and state-changing
  // requests that declare an Origin must come from an allowed one.
  app.addHook("onRequest", async (request) => {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) throw errors.csrf();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }


    const status = httpStatus(error);
    switch (status) {
      case 404:
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Resource not found" },
        });
      case 413:
        return reply.code(413).send({
          error: { code: "PAYLOAD_TOO_LARGE", message: "Upload is too large" },
        });
      case 415:
        return reply.code(415).send({
          error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Unsupported media type" },
        });
      case 429:
        return reply.code(429).send({
          error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly" },
        });
      default:
        if (status >= 400 && status < 500) {
          const message = error instanceof Error ? error.message : "Request failed";
          return reply
            .code(status)
            .send({ error: { code: "VALIDATION_ERROR", message } });
        }
    }

    request.log.error(error);
    return reply
      .code(500)
      .send({ error: { code: "INTERNAL", message: "Something went wrong" } });
  });

  app.get("/health", async () => ({ ok: true }));

  app.register(authRoutes, { prefix: "/auth" });
  app.register(passwordRoutes, { prefix: "/auth" });
  app.register(transcriptRoutes, { prefix: "/transcripts" });
  app.register(streamRoutes, { prefix: "/transcripts" });

  return app;
}
