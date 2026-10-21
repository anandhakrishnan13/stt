import { buildApp } from "./app";
import { closeDb } from "./db";
import { runMigrations } from "./db/migrate";
import { env } from "./env";

runMigrations();

const app = await buildApp({ logger: true });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  });
}

await app.listen({ port: env.PORT, host: "0.0.0.0" });
