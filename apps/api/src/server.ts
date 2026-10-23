import { buildApp } from "./app";
import { closeDb, warmDb } from "./db";
import { env } from "./env";

const app = buildApp({ logger: true });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  });
}

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

void warmDb().catch((error: unknown) => {
  app.log.warn({ err: error }, "database warmup failed");
});
