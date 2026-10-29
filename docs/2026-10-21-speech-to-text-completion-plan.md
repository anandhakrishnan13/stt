# Speech-to-Text Completion (Groq + PostgreSQL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the live transcription feature by moving speech-to-text to Groq-hosted Whisper and making PostgreSQL the only database, with Supabase Postgres in production and Docker Postgres locally.

**Architecture:** The browser keeps streaming 16 kHz mono PCM over the existing authenticated WebSocket. The API buffers 6-second windows, sends each window as a WAV file to Groq's OpenAI-compatible transcription endpoint, and persists finalized segments. PostgreSQL stores users, sessions, transcripts, segments, and audit events. Supabase Storage keeps the archived audio. No local inference service is deployed; the production server only runs the API and web app.

**Tech Stack:** Bun 1.4+, TypeScript strict, Fastify 5, Drizzle ORM 0.44, `postgres` (postgres.js), PostgreSQL 17 / Supabase Postgres, Next.js 15, React 19, Groq Whisper (`whisper-large-v3-turbo`), Supabase Storage REST API.

**Spec:** Assignment brief from the conversation. There is no separate design document for this completion work; the existing auth design lives at `docs/superpowers/specs/2026-10-21-auth-design.md`.

## Global Constraints

- **PostgreSQL only.** Remove SQLite, `bun:sqlite`, `drizzle-orm/bun-sqlite`, and `file:` database URLs. Do not add PGlite or another SQL dialect.
- **Local development and tests:** PostgreSQL 17 from `docker-compose.yml`.
- **Production:** Supabase Postgres through the **session pooler** on port `5432`, with `ssl: "require"` and `prepare: false`.
- **Speech-to-text:** Groq `whisper-large-v3-turbo` over the hosted Groq API by default (`STT_PROVIDER=groq`). There is no local Whisper adapter and no `whisper` provider value; the only self-deployed engine is Whistle (`STT_PROVIDER=whistle`, `https://whistle.heureux.tech`).
- **Window size:** `STT_STEP_MS=6000`, `STT_MAX_WINDOW_MS=6000`, `STT_MIN_WINDOW_MS=1500`. This keeps Groq at 10 requests/minute and under the free-tier 20 RPM and 7,200 audio-seconds/hour limits. Do not send a request every 2–3 seconds.
- **Audio:** 16 kHz, mono, signed 16-bit little-endian PCM. WAV headers are generated server-side.
- **Limits:** `MAX_AUDIO_BYTES=10485760` (10 MiB) to match the Supabase bucket; recordings are capped at one hour.
- **Secrets:** `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `JWT_SECRET`, and `OTP_PEPPER` stay server-side. Never expose them through `NEXT_PUBLIC_*`.
- **Compatibility:** Keep the existing API DTOs and browser behavior. The current live UI, `segments` response, playback, CRUD, and auth must continue to work.
- **Tests:** The existing suite must pass on PostgreSQL. Add tests for Groq requests, rate limiting, the stream socket, and missing Supabase objects.

## Review Focus

- A missing Supabase object returns HTTP **400** with `{"code":"NoSuchKey"}`, not 404. Playback must return 404, not a 500 or a response with `content-length: 88`.
- PostgreSQL `LIKE` is case-sensitive; the existing search test (`weekly` matches `Weekly sync`) must use `ILIKE`.
- Supabase's pooler requires SSL and does not reliably support prepared statements; the app must use `ssl: "require"` and `prepare: false`.
- Groq's free tier bills a 10-second minimum per request and allows 20 RPM. Six-second windows, `Retry-After` handling, and a cooldown are required.
- A user who stops after less than one full window must still get the final audio transcribed.
- Tests must not share one PostgreSQL database; each test process gets a disposable database, or truncation races will make the suite flaky.
- New `sb_secret_...` Supabase keys are not JWTs; sending one as `Authorization: Bearer` is wrong even though the old adapter got away with it.

---

### Task 1: Baseline the live-transcription work

**Files:**
- Verify: whole repository
- Commit: the uncommitted Slice 4 files listed below

**Interfaces:**
- Consumes: nothing.
- Produces: a clean git baseline so later PostgreSQL and Groq changes are reviewable.

The working tree currently contains the live-transcription slice: `apps/api/src/routes/stream.ts`, `apps/api/src/lib/stt/`, `apps/api/src/lib/transcript-access.ts`, `apps/api/test/stt.test.ts`, `apps/web/lib/pcm-stream.ts`, `apps/web/public/worklet/pcm-processor.js`, plus edits to the schema, composer, recorder, detail page, shared types, and a SQLite migration. The live UI and segment rendering are already implemented; do not rewrite them.

- [ ] **Step 1: Install from the lockfile**

Run:

```bash
bun install
```

Expected: install completes without changing `bun.lock` unexpectedly.

- [ ] **Step 2: Run the existing suite**

Run:

```bash
bun test
bun run typecheck
```

Expected: the current SQLite-backed suite passes and both workspaces typecheck. Record the test count in the commit message if it changed.

- [ ] **Step 3: Commit the baseline**

```bash
git add -A
git commit -m "feat(live): stream 16 kHz PCM and persist transcript segments"
```

Expected: `git status --short` is empty.

---

### Task 2: Fix Supabase storage for new secret keys and missing objects

**Files:**
- Modify: `apps/api/src/lib/storage.ts`
- Test: `apps/api/test/storage-supabase.test.ts`

**Interfaces:**
- Consumes: `env.SUPABASE_URL`, `env.SUPABASE_SERVICE_ROLE_KEY`, `env.SUPABASE_BUCKET`.
- Produces: `export function supabaseAuthHeaders(key: string): Record<string, string>` returning `{ apikey }` for every key and adding `authorization: Bearer <key>` only when `key.startsWith("eyJ")`.
- Produces: `SupabaseStorage.size(key)` returns `null` for HTTP 400 or 404; `read(key)` returns `null` for 404 or a 400 body whose JSON has `code === "NoSuchKey"`.

- [ ] **Step 1: Make the stub behave like Supabase and add assertions**

In `apps/api/test/storage-supabase.test.ts`:

1. Replace the missing-object response:

```ts
if (!bytes) {
  return Response.json(
    { code: "NoSuchKey", message: "Object not found" },
    { status: 400 },
  );
}
```

2. Add a unit test for header selection:

```ts
import { supabaseAuthHeaders } from "../src/lib/storage";

test("sends apikey for new secret keys and Bearer only for JWTs", () => {
  expect(supabaseAuthHeaders("sb_secret_example")).toEqual({
    apikey: "sb_secret_example",
  });
  expect(supabaseAuthHeaders("eyJhbGciOiJIUzI1NiJ9.payload.signature")).toEqual({
    apikey: "eyJhbGciOiJIUzI1NiJ9.payload.signature",
    authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
  });
});
```

3. In the spawned-driver test, keep `SUPABASE_SERVICE_ROLE_KEY: "service-role-key"` and add:

```ts
expect(upload?.headers.get("apikey")).toBe("service-role-key");
expect(upload?.headers.get("authorization")).toBeNull();
expect(result.afterRemove).toBeNull();
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
bun test apps/api/test/storage-supabase.test.ts
```

Expected: FAIL because `supabaseAuthHeaders` does not exist and `afterRemove` is `88` instead of `null`.

- [ ] **Step 3: Implement the header and missing-object handling**

In `apps/api/src/lib/storage.ts`:

```ts
export function supabaseAuthHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key };
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
  return headers;
}
```

Use `supabaseAuthHeaders(env.SUPABASE_SERVICE_ROLE_KEY)` everywhere the adapter currently builds `this.auth`.

Replace `size()` with:

```ts
async size(key: string): Promise<number | null> {
  const response = await fetch(this.url(key), {
    method: "HEAD",
    headers: supabaseAuthHeaders(env.SUPABASE_SERVICE_ROLE_KEY),
  });
  if (response.status === 400 || response.status === 404) return null;
  if (response.status !== 200) {
    throw new Error(`Supabase stat failed: ${response.status}`);
  }
  const length = Number(response.headers.get("content-length"));
  return Number.isFinite(length) ? length : null;
}
```

In `read()`, parse a 400 body before throwing:

```ts
if (response.status === 404) return null;
if (response.status === 400) {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && "code" in body && body.code === "NoSuchKey") {
    return null;
  }
  throw new Error("Supabase download failed: 400");
}
if (response.status !== 200 && response.status !== 206) {
  throw new Error(`Supabase download failed: ${response.status}`);
}
```

- [ ] **Step 4: Run the test and the storage-related suite**

Run:

```bash
bun test apps/api/test/storage-supabase.test.ts
```

Expected: PASS. The removed object reports `null`, and the upload request has `apikey` but no `authorization`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/storage.ts apps/api/test/storage-supabase.test.ts
git commit -m "fix(storage): handle Supabase secret keys and missing objects"
```

---

### Task 3: Make PostgreSQL the only database

**Files:**
- Modify: `apps/api/package.json`, `docker-compose.yml`, `apps/api/src/env.ts`, `apps/api/.env.example`, `apps/api/src/db/schema.ts`, `apps/api/src/db/index.ts`, `apps/api/src/db/migrate.ts`, `apps/api/drizzle.config.ts`, `apps/api/src/routes/transcripts.ts`
- Modify: `apps/api/test/setup.ts`, `apps/api/test/auth.test.ts`, `apps/api/test/recording.test.ts`, `apps/api/test/transcripts.test.ts`
- Create: `apps/api/test/db.ts`, `apps/api/test/db.test.ts`
- Delete: `apps/api/drizzle/` (all SQLite migration files and snapshots)

**Interfaces:**
- Consumes: `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_POOL_MAX`.
- Produces: `db` from `drizzle-orm/postgres-js`; `sqlClient` is the postgres.js client; `closeDb(): Promise<void>`.
- Produces: `runMigrations(url?: string, ssl?: boolean): Promise<void>`.
- Produces: `resetDb(): Promise<void>` in `apps/api/test/db.ts`, truncating all application tables.
- Produces: environment validation rejects any database URL that is not `postgres://` or `postgresql://`.

- [ ] **Step 1: Add PostgreSQL dependencies and the local service**

Run:

```bash
bun add postgres --cwd apps/api
```

Add to `docker-compose.yml`:

```yaml
  postgres:
    image: postgres:17-alpine
    container_name: stt-postgres
    environment:
      POSTGRES_USER: stt
      POSTGRES_PASSWORD: stt
      POSTGRES_DB: stt
    ports:
      - "5432:5432"
    volumes:
      - stt-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U stt -d stt"]
      interval: 2s
      timeout: 3s
      retries: 20

volumes:
  stt-postgres-data:
```

Start it:

```bash
bun run services:up
docker compose ps
```

Expected: `stt-postgres` is healthy and Mailpit still starts.

- [ ] **Step 2: Write the failing PostgreSQL test**

Create `apps/api/test/db.test.ts`:

```ts
import { expect, test } from "bun:test";
import { sqlClient } from "../src/db";

test("the application database is PostgreSQL", async () => {
  const rows = await sqlClient.unsafe<{ version: string }[]>("select version()");
  expect(rows[0]?.version).toContain("PostgreSQL");
});

test("timestamps round-trip as Date objects", async () => {
  const rows = await sqlClient.unsafe<{ now: Date }[]>("select now() as now");
  expect(rows[0]?.now).toBeInstanceOf(Date);
});
```

Run:

```bash
bun test apps/api/test/db.test.ts
```

Expected: FAIL because `sqlClient.unsafe` does not exist on the SQLite client.

- [ ] **Step 3: Convert the schema to pg-core**

In `apps/api/src/db/schema.ts`, replace the imports and table constructors:

```ts
import { randomUUID } from "node:crypto";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

const createdAt = () =>
  timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date());
```

Use `pgTable` for every table. Replace every `integer("...", { mode: "timestamp_ms" })` with `timestamp("...", { withTimezone: true })`. Keep the same column names, defaults, foreign keys with `onDelete`, indexes, and enum values.

Convert `auditEvents.metadata` to:

```ts
metadata: jsonb("metadata").$type<Record<string, unknown>>(),
```

Add `"groq-whisper"` to the `transcripts.engine` enum now:

```ts
engine: text("engine", { enum: ["gemini-live", "whisper-local", "groq-whisper"] }),
```

- [ ] **Step 4: Replace the driver and migration runner**

Replace `apps/api/src/db/index.ts` with:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export const sqlClient = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
  prepare: false,
  ssl: env.DATABASE_SSL ? "require" : false,
  connect_timeout: 10,
  idle_timeout: 20,
  onnotice: () => {},
});

export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;

export async function closeDb(): Promise<void> {
  await sqlClient.end({ timeout: 5 });
}
```

Replace `apps/api/src/db/migrate.ts` with:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../env";

const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;

export async function runMigrations(
  url = env.DATABASE_URL,
  ssl = env.DATABASE_SSL,
): Promise<void> {
  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: ssl ? "require" : false,
    onnotice: () => {},
  });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  await runMigrations();
  console.log("migrations applied");
}
```

Update `apps/api/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://stt:stt@127.0.0.1:5432/stt",
  },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 5: Add and validate PostgreSQL environment variables**

In `apps/api/src/env.ts`, replace the database field:

```ts
DATABASE_URL: z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
    "DATABASE_URL must be a PostgreSQL connection string",
  )
  .default("postgresql://stt:stt@127.0.0.1:5432/stt"),
DATABASE_SSL: z
  .string()
  .default("false")
  .transform((value) => value === "true"),
DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
```

In `apps/api/.env.example`, replace the SQLite line and document both modes:

```dotenv
# PostgreSQL only. Local Docker Postgres:
DATABASE_URL=postgresql://stt:stt@127.0.0.1:5432/stt
DATABASE_SSL=false
DATABASE_POOL_MAX=5
# Production Supabase session pooler (replace password and region):
# DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
# DATABASE_SSL=true
```

- [ ] **Step 6: Regenerate migrations and apply them**

Delete the SQLite migration history:

```bash
rm -rf apps/api/drizzle
bun run db:generate
bun run db:migrate
```

Expected: `apps/api/drizzle/0000_*.sql` and a fresh `meta/` directory are created; `migrations applied` prints. Inspect the SQL and confirm it contains `CREATE TABLE "users"`, `"transcripts"`, `"segments"`, cascading foreign keys, and the Postgres timestamp types.

Verify directly:

```bash
docker compose exec postgres psql -U stt -d stt -c '\dt'
```

Expected: `users`, `refresh_tokens`, `email_otps`, `transcripts`, `segments`, `audit_events`, and `__drizzle_migrations`.

- [ ] **Step 7: Provision a disposable PostgreSQL database for each test process**

Replace `apps/api/test/setup.ts` with a version that:

1. Reads `TEST_DATABASE_URL`, defaulting to `postgresql://stt:stt@127.0.0.1:5432/postgres`.
2. Creates a unique database named `stt_test_<pid>_<random>`. Use an admin `postgres` client with `max: 1`.
3. Sets `process.env.DATABASE_URL` to that database and `DATABASE_SSL=false`.
4. Keeps the existing JWT, OTP, SMTP, rate-limit, storage, and STT test environment values.
5. Imports `runMigrations` dynamically and awaits it.
6. Registers `afterAll` to call `closeDb()`, then `DROP DATABASE IF EXISTS "<name>" WITH (FORCE)`, then close the admin client.

The core shape:

```ts
import { afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const adminUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://stt:stt@127.0.0.1:5432/postgres";
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const database = `stt_test_${process.pid}_${randomUUID().slice(0, 8)}`;

await admin.unsafe(`CREATE DATABASE "${database}"`);

const url = new URL(adminUrl);
url.pathname = `/${database}`;
process.env.DATABASE_URL = url.toString();
process.env.DATABASE_SSL = "false";

const { runMigrations } = await import("../src/db/migrate");
await runMigrations();

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end({ timeout: 5 });
});
```

Set the remaining test env values before the dynamic imports, including:

```ts
process.env.STT_PROVIDER = "groq";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.STT_STEP_MS = "2000";
process.env.STT_MAX_WINDOW_MS = "2000";
process.env.STT_MIN_WINDOW_MS = "500";
```

Add `TEST_DATABASE_URL` to `apps/api/.env.example`:

```dotenv
TEST_DATABASE_URL=postgresql://stt:stt@127.0.0.1:5432/postgres
```

If `CREATE DATABASE` fails with a connection error, print `Start PostgreSQL with: bun run services:up` before rethrowing.

- [ ] **Step 8: Add the truncation helper and update the existing tests**

Create `apps/api/test/db.ts`:

```ts
import { sqlClient } from "../src/db";

export async function resetDb(): Promise<void> {
  await sqlClient.unsafe(
    "TRUNCATE TABLE audit_events, email_otps, refresh_tokens, segments, transcripts, users RESTART IDENTITY CASCADE",
  );
}
```

In `auth.test.ts`, `recording.test.ts`, and `transcripts.test.ts`, replace the multiple `sqlClient.exec("DELETE ...")` calls with:

```ts
await resetDb();
```

Keep the existing `beforeEach` order: reset first, then create fixtures.

- [ ] **Step 9: Fix case-insensitive search for PostgreSQL**

In `apps/api/src/routes/transcripts.ts`, change the search filter from `LIKE` to `ILIKE`:

```ts
filters.push(sql`${transcripts.title} ILIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'`);
```

The existing test `searches titles and treats wildcards literally` must pass unchanged: `weekly` matches `Weekly sync`, and `%` is treated as a literal percent sign.

- [ ] **Step 10: Run the whole suite on PostgreSQL**

Run:

```bash
bun test
bun run typecheck
```

Expected: PASS, including `apps/api/test/db.test.ts`, all auth tests, recording tests, transcript CRUD tests, and the search test. No test may reference `local.db`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor(db): move from SQLite to PostgreSQL"
```

---

### Task 4: Add the Groq Whisper provider

**Files:**
- Modify: `apps/api/src/env.ts`, `apps/api/.env.example`, `apps/api/src/lib/stt/whisper.ts`
- Create: `apps/api/src/lib/stt/groq.ts`, `apps/api/src/lib/stt/index.ts`
- Test: `apps/api/test/groq.test.ts`

**Interfaces:**
- Consumes: `GROQ_API_KEY`, `GROQ_BASE_URL`, `STT_GROQ_MODEL`, `GROQ_TIMEOUT_MS`, `STT_LANGUAGE`, `STT_PROMPT`.
- Produces: `transcribeGroq(pcm: Uint8Array, prompt?: string): Promise<Transcription>`.
- Produces: `class SttRateLimitError extends Error { readonly retryAfterMs: number }`.
- Produces: `transcribePcm(pcm: Uint8Array, prompt?: string): Promise<Transcription>` in `apps/api/src/lib/stt/index.ts`, dispatching on `STT_PROVIDER`.
- Produces: `extractWords` is exported from `whisper.ts` for reuse by Groq.

- [ ] **Step 1: Write the failing Groq adapter test**

Create `apps/api/test/groq.test.ts`. Use a `Bun.serve` stub and a spawned child, mirroring `storage-supabase.test.ts` so the child reads its own environment.

The parent stub must:

- Accept `POST /openai/v1/audio/transcriptions`.
- Parse `await request.formData()`.
- Record `model`, `response_format`, `temperature`, `timestamp_granularities[]`, `file` name/type, and the WAV bytes.
- Return:

```json
{
  "text": "Namaste, how are you?",
  "language": "hindi",
  "segments": [
    {
      "words": [
        { "word": "Namaste,", "start": 0, "end": 0.4 },
        { "word": "how", "start": 0.4, "end": 0.6 },
        { "word": "are", "start": 0.6, "end": 0.8 },
        { "word": "you?", "start": 0.8, "end": 1.0 }
      ]
    }
  ]
}
```

The last word's `end` is deliberately equal to the sent window duration so the committed prefix trims the whole buffer and the stop-time final pass does not duplicate the stub text.

The child imports `transcribeGroq` from `../src/lib/stt/groq.ts`, passes one second of Int16 tone, and prints the result as JSON.

Assertions:

```ts
expect(result.text).toBe("Namaste, how are you?");
expect(result.language).toBe("hindi");
expect(result.words).toHaveLength(4);
expect(request.model).toBe("whisper-large-v3-turbo");
expect(request.responseFormat).toBe("verbose_json");
expect(request.temperature).toBe("0");
expect(request.timestampGranularity).toBe("word");
expect(request.fileName).toBe("window.wav");
expect(request.fileType).toBe("audio/wav");
expect(request.wavStartsWithRiff).toBe(true);
```

Add a second child run with a stub that returns HTTP 429 and `retry-after: 2`. Expect:

```ts
expect(result.name).toBe("SttRateLimitError");
expect(result.retryAfterMs).toBe(2000);
```

Run:

```bash
bun test apps/api/test/groq.test.ts
```

Expected: FAIL because `groq.ts` does not exist.

- [ ] **Step 2: Add the environment fields and validation**

In `apps/api/src/env.ts`, add:

```ts
STT_PROVIDER: z.enum(["groq", "whisper"]).default("groq"),
STT_LANGUAGE: z.string().default(""),
STT_PROMPT: z
  .string()
  .default(
    "Transcribe Hindi and English speech, including code-mixed Hinglish. Keep the spoken language and script.",
  ),
GROQ_API_KEY: z.string().default(""),
GROQ_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
STT_GROQ_MODEL: z.string().default("whisper-large-v3-turbo"),
GROQ_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
```

After parsing, require a key for Groq:

```ts
if (parsed.data.STT_PROVIDER === "groq" && !parsed.data.GROQ_API_KEY) {
  throw new Error(
    "Invalid environment:\nGROQ_API_KEY is required when STT_PROVIDER=groq",
  );
}
```

Add the same keys to `apps/api/.env.example` with a comment that `GROQ_API_KEY` is server-only.

- [ ] **Step 3: Export the reusable word parser**

In `apps/api/src/lib/stt/whisper.ts`, export the payload type and parser:

```ts
export type VerbosePayload = {
  text?: unknown;
  language?: unknown;
  segments?: { words?: { word?: unknown; start?: unknown; end?: unknown }[] }[];
};

export function extractWords(
  payload: VerbosePayload,
  text: string,
  durationMs: number,
): Word[] {
  // existing body unchanged
}
```

Update the internal call site if necessary.

- [ ] **Step 4: Implement the Groq adapter**

Create `apps/api/src/lib/stt/groq.ts`:

```ts
import { env } from "../../env";
import {
  cleanTranscript,
  extractWords,
  pcm16ToWav,
  SAMPLE_RATE,
  type Transcription,
  type VerbosePayload,
} from "./whisper";

export class SttRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("Groq rate limit reached");
    this.name = "SttRateLimitError";
  }
}

export async function transcribeGroq(
  pcm: Uint8Array,
  prompt?: string,
): Promise<Transcription> {
  const wav = pcm16ToWav(pcm);
  const form = new FormData();
  form.set("file", new File([wav], "window.wav", { type: "audio/wav" }));
  form.set("model", env.STT_GROQ_MODEL);
  form.set("response_format", "verbose_json");
  form.set("temperature", "0");
  form.set("timestamp_granularities[]", "word");
  if (env.STT_LANGUAGE) form.set("language", env.STT_LANGUAGE);
  const effectivePrompt = prompt ?? env.STT_PROMPT;
  if (effectivePrompt) form.set("prompt", effectivePrompt);

  const response = await fetch(
    `${env.GROQ_BASE_URL.replace(/\/+$/, "")}/audio/transcriptions`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(env.GROQ_TIMEOUT_MS),
    },
  );

  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
    throw new SttRateLimitError(retryAfterMs);
  }
  if (!response.ok) {
    throw new Error(`Groq returned ${response.status}`);
  }

  const payload = (await response.json()) as VerbosePayload;
  const text = cleanTranscript(typeof payload.text === "string" ? payload.text : "");
  const durationMs = (pcm.byteLength / 2 / SAMPLE_RATE) * 1000;
  return {
    text,
    language: typeof payload.language === "string" ? payload.language.toLowerCase() : null,
    words: extractWords(payload, text, durationMs),
  };
}
```

- [ ] **Step 5: Add the provider dispatcher**

Create `apps/api/src/lib/stt/index.ts`:

```ts
import { env } from "../../env";
import { transcribeGroq } from "./groq";
import { transcribePcm as transcribeWhisper, type Transcription } from "./whisper";

export { SttRateLimitError } from "./groq";
export type { Transcription, Word } from "./whisper";

export function transcribePcm(
  pcm: Uint8Array,
  prompt?: string,
): Promise<Transcription> {
  if (env.STT_PROVIDER === "groq") return transcribeGroq(pcm, prompt);
  return transcribeWhisper(pcm, prompt);
}
```

- [ ] **Step 6: Run the Groq tests and typecheck**

```bash
bun test apps/api/test/groq.test.ts
bun run typecheck
```

Expected: PASS. The upload is a real WAV, the model is `whisper-large-v3-turbo`, word timestamps are requested, and 429 produces a typed rate-limit error with the parsed retry delay.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/env.ts apps/api/.env.example apps/api/src/lib/stt apps/api/test/groq.test.ts
git commit -m "feat(stt): add Groq Whisper transcription provider"
```

---

### Task 5: Use Groq in the live stream

**Files:**
- Modify: `apps/api/src/routes/stream.ts`, `apps/api/src/env.ts`, `apps/api/.env.example`
- Test: `apps/api/test/stream.test.ts`

**Interfaces:**
- Consumes: `transcribePcm`, `SttRateLimitError` from `../lib/stt`.
- Consumes: `env.STT_PROVIDER`, `env.STT_STEP_MS`, `env.STT_MAX_WINDOW_MS`, `env.STT_MIN_WINDOW_MS`.
- Produces: transcript `engine` is `"groq-whisper"` when `STT_PROVIDER=groq`, otherwise `"whisper-local"`.
- Produces: the first committed segment sets the transcript title when the title still starts with `"Recording · "`.

- [ ] **Step 1: Set the production window defaults**

In `apps/api/src/env.ts`, change:

```ts
STT_STEP_MS: z.coerce.number().int().min(500).default(6_000),
STT_MAX_WINDOW_MS: z.coerce.number().int().min(2_000).default(6_000),
STT_MIN_WINDOW_MS: z.coerce.number().int().min(200).default(1_500),
```

Update `apps/api/.env.example` and `apps/api/.env` to the same three values:

```dotenv
STT_STEP_MS=6000
STT_MAX_WINDOW_MS=6000
STT_MIN_WINDOW_MS=1500
```

There is no local Whisper server and no `WHISPER_URL`/`WHISPER_TIMEOUT_MS` variables. Whisper is reached through Groq at `GROQ_BASE_URL` (`apps/api/src/lib/stt/groq.ts`); Whistle is the self-deployed engine.

- [ ] **Step 2: Write the failing stream test**

Create `apps/api/test/stream.test.ts`. The test setup already points `STT_PROVIDER` at Groq, but the URL is the real one, so intercept `globalThis.fetch` for `/audio/transcriptions` instead of making a network call.

The test must:

1. Import `buildApp`, `db`, `transcripts`, `segments`, `users`, `signAccessToken`, and `ACCESS_COOKIE`.
2. Create an active user and a `status: "recording"` transcript directly in the database. Save the original title from `defaultTitle` shape, e.g. `"Recording · 21 Oct, 10:30"`.
3. Start the app on a random port:

```ts
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
if (!address || typeof address === "string") throw new Error("no port");
const wsUrl = `ws://127.0.0.1:${address.port}/transcripts/${transcriptId}/stream`;
```

4. Replace `globalThis.fetch`:

```ts
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.endsWith("/audio/transcriptions")) return originalFetch(input, init);
  return Response.json({
    text: "Hello from the test",
    language: "english",
    segments: [
      {
        words: [
          { word: "Hello", start: 0, end: 0.5 },
          { word: "from", start: 0.5, end: 1.0 },
          { word: "the", start: 1.0, end: 1.5 },
          { word: "test", start: 1.5, end: 2.2 },
        ],
      },
    ],
  });
};
```

5. Open the socket with the access cookie:

```ts
const socket = new WebSocket(wsUrl, {
  headers: { cookie: `${ACCESS_COOKIE}=${token}` },
} as never);
```

6. Wait for `{type:"ready"}`, send 2.2 seconds of a 16 kHz Int16 tone as one binary frame, and wait for `{type:"segment"}`.
7. Send `{type:"stop"}` and wait for `{type:"done"}`.
8. Assert:

```ts
expect(segment.text).toBe("Hello from the test");
const [row] = await db.select().from(transcripts).where(eq(transcripts.id, transcriptId));
expect(row?.engine).toBe("groq-whisper");
expect(row?.title).toBe("Hello from the test");
const stored = await db.select().from(segments).where(eq(segments.transcriptId, transcriptId));
expect(stored.map((item) => item.text)).toEqual(["Hello from the test"]);
```

9. Add a second test that sends only 0.8 seconds (above the test `STT_MIN_WINDOW_MS=500`) and then `{type:"stop"}`, asserting a segment is still persisted. This proves the final partial window is flushed.
10. Restore `globalThis.fetch` and close the app in `afterAll`.

Run:

```bash
bun test apps/api/test/stream.test.ts
```

Expected: FAIL because the socket currently calls the real Groq URL / the default window is not 6 seconds / the title is not updated.

- [ ] **Step 3: Switch the stream to the provider dispatcher**

In `apps/api/src/routes/stream.ts`:

```ts
import { pcm16Rms } from "../lib/stt/whisper";
import { SttRateLimitError, transcribePcm } from "../lib/stt";
```

Add:

```ts
function engineName(): "groq-whisper" | "whisper-local" {
  return env.STT_PROVIDER === "groq" ? "groq-whisper" : "whisper-local";
}

function titleFromSpeech(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 77).trimEnd()}…` : clean;
}
```

Replace the fixed `engine: "whisper-local"` update with a single update that also sets the title on the first segment:

```ts
await db
  .update(transcripts)
  .set({
    engine: engineName(),
    language: detectedLanguage,
    title: sql`case
      when ${transcripts.title} like ${"Recording · %"} then ${titleFromSpeech(text)}
      else ${transcripts.title}
    end`,
    updatedAt: new Date(),
  })
  .where(eq(transcripts.id, transcriptId));
```

Import `sql` from `drizzle-orm`.

- [ ] **Step 4: Handle Groq rate limits with a cooldown**

Add `let cooldownUntil = 0;` to the session state.

At the top of `runPass`:

```ts
if (Date.now() < cooldownUntil) return;
```

In the `catch` block around `transcribePcm`:

```ts
} catch (error) {
  if (error instanceof SttRateLimitError) {
    cooldownUntil = Date.now() + error.retryAfterMs;
    lastInferredMs = 0;
    reportError(
      `Transcription is rate limited; retrying in ${Math.ceil(error.retryAfterMs / 1000)}s.`,
    );
    setTimeout(() => kick(), error.retryAfterMs + 50);
    return;
  }
  reportError("Transcription engine did not answer; retrying");
}
```

At the top of `kick`:

```ts
if (Date.now() < cooldownUntil) return;
```

This keeps the buffer intact, avoids a tight retry loop, and resumes when Groq's `Retry-After` has elapsed.

- [ ] **Step 5: Run the stream test and the full suite**

```bash
bun test apps/api/test/stream.test.ts
bun test
bun run typecheck
```

Expected: PASS. The first segment sets the title, the engine is `groq-whisper`, and the final partial window is persisted.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/stream.ts apps/api/src/env.ts apps/api/.env.example apps/api/test/stream.test.ts
git commit -m "feat(live): transcribe six-second windows with Groq"
```

---

### Task 6: Add the Groq engine label to the web app

**Files:**
- Modify: `packages/shared/src/index.ts`, `apps/web/lib/transcripts.ts`

**Interfaces:**
- Consumes: `TranscriptDTO["engine"]`.
- Produces: the shared union includes `"groq-whisper"`, and `ENGINE_LABEL` maps it to `"Whisper via Groq"`.

- [ ] **Step 1: Update the shared DTO**

In `packages/shared/src/index.ts`:

```ts
engine: "gemini-live" | "whisper-local" | "groq-whisper" | null;
```

- [ ] **Step 2: Update the label map**

In `apps/web/lib/transcripts.ts`:

```ts
export const ENGINE_LABEL: Record<NonNullable<TranscriptDTO["engine"]>, string> = {
  "gemini-live": "Gemini Live",
  "whisper-local": "Whisper (local)",
  "groq-whisper": "Whisper via Groq",
};
```

The live composer and detail page already render `SegmentDTO`s and the `interim` event; no layout changes are needed.

- [ ] **Step 3: Typecheck and build**

```bash
bun run typecheck
bun run --cwd apps/web build
```

Expected: PASS. The detail page shows `Whisper via Groq` for new recordings.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/index.ts apps/web/lib/transcripts.ts
git commit -m "feat(web): label Groq Whisper recordings"
```

---

### Task 7: Harden Supabase Postgres and document the final setup

**Files:**
- Create: `scripts/supabase-hardening.sql`
- Modify: `README.md`, `apps/api/.env.example`, `docker-compose.yml`
- Optionally update: `docs/superpowers/specs/2026-10-21-auth-design.md` if it mentions SQLite

**Interfaces:**
- Consumes: the tables created by Task 3.
- Produces: a SQL file that enables RLS and revokes `anon` / `authenticated` access on application tables.

- [ ] **Step 1: Add the Supabase hardening SQL**

Create `scripts/supabase-hardening.sql`:

```sql
-- Run once after migrations against the Supabase database.
-- The API connects as the table owner, which bypasses RLS. Browser clients
-- using the publishable/anon key get no access because there are no policies.
alter table public.users enable row level security;
alter table public.refresh_tokens enable row level security;
alter table public.email_otps enable row level security;
alter table public.transcripts enable row level security;
alter table public.segments enable row level security;
alter table public.audit_events enable row level security;

revoke all on table public.users from anon, authenticated;
revoke all on table public.refresh_tokens from anon, authenticated;
revoke all on table public.email_otps from anon, authenticated;
revoke all on table public.transcripts from anon, authenticated;
revoke all on table public.segments from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;
```

Run it from the Supabase SQL editor or:

```bash
psql "$DATABASE_URL" -f scripts/supabase-hardening.sql
```

- [ ] **Step 2: Rewrite the README setup and architecture sections**

Update `README.md` to cover:

- Stack: Next.js web, Fastify API, PostgreSQL 17 / Supabase Postgres, Supabase Storage, Groq Whisper.
- Local quick start:

```bash
bun install
bun run setup
bun run services:up
bun run db:migrate
bun run dev:api
bun run dev:web
```

- Database: PostgreSQL only. Docker Postgres is `postgresql://stt:stt@127.0.0.1:5432/stt`; production uses the Supabase **session pooler** URI with `DATABASE_SSL=true`.
- Supabase Storage: private bucket `transcripts`, 10 MiB limit, secret key server-side only.
- Groq: `GROQ_API_KEY`, `STT_PROVIDER=groq`, `STT_GROQ_MODEL=whisper-large-v3-turbo`, 6-second windows, 20 RPM / 10-second minimum billing, `Retry-After` handling.
- Testing: `bun run services:up` before `bun test`; tests create and drop a disposable database per process.
- Deployment on a 2-vCPU ARM server: run only the API and web app; no local Whisper inference. Supabase handles Postgres and audio storage, Groq handles transcription.
- Security: never put `SUPABASE_SERVICE_ROLE_KEY` or `GROQ_API_KEY` in `NEXT_PUBLIC_*`; keep the Supabase bucket private; apply the hardening SQL.

Remove every SQLite reference from the README and `.env.example`, including `local.db` and `file:` URLs.

- [ ] **Step 3: Check for leftover SQLite references**

```bash
rg -n "sqlite|SQLite|bun:sqlite|local\.db|file:\./local" README.md apps packages scripts docker-compose.yml
```

Expected: no matches outside historical docs that explicitly describe the migration. Fix any live setup text.

- [ ] **Step 4: Commit**

```bash
git add README.md apps/api/.env.example scripts/supabase-hardening.sql docker-compose.yml
git commit -m "docs: document Groq and PostgreSQL deployment"
```

---

### Task 8: End-to-end verification

**Files:**
- Verify: whole repository
- No code changes expected

**Interfaces:**
- Consumes: all prior tasks.
- Produces: evidence that the assignment works with a real microphone, Supabase Storage, Groq, and PostgreSQL.

- [ ] **Step 1: Start the services and migrate**

```bash
bun run services:up
bun run db:migrate
```

Expected: Postgres and Mailpit are healthy; migrations apply without error.

- [ ] **Step 2: Run the automated checks**

```bash
bun test
bun run typecheck
bun run --cwd apps/web build
```

Expected: all tests pass, both workspaces typecheck, and the Next.js production build succeeds.

- [ ] **Step 3: Verify the production database connection**

Set `DATABASE_URL` to the Supabase session-pooler URI with `DATABASE_SSL=true`, then run:

```bash
bun run db:migrate
```

Expected: migrations apply to Supabase. Confirm the tables in the Supabase Table Editor. Apply `scripts/supabase-hardening.sql` once.

- [ ] **Step 4: Manual browser check**

Use the browser with a microphone:

1. Sign up and verify the email through Mailpit (`http://localhost:8025`).
2. Start a recording and speak Hindi, English, and Hinglish.
3. Confirm text appears in the composer roughly every 6–7 seconds and the interim line updates.
4. Stop after a partial window (under 6 seconds) and confirm the final words are saved.
5. Confirm the detail page shows timestamped segments, the title is derived from the first segment, and playback works.
6. Rename and delete the transcript from the sidebar.
7. Confirm the audio object exists in the Supabase `transcripts` bucket and the transcript row exists in Supabase Postgres.

- [ ] **Step 5: Check the failure paths**

1. With `STORAGE_DRIVER=supabase`, request audio for a transcript whose object was deleted: expect `404`, not `500`.
2. Search for a lowercase term that matches a title with different casing: expect the transcript.
3. Temporarily set an invalid `GROQ_API_KEY`: recording still saves audio, and the UI shows a non-blocking transcription error.
4. Confirm another user cannot read, rename, delete, or play the first user's transcript (`404`).

- [ ] **Step 6: Final commit if verification required fixes**

```bash
git add -A
git commit -m "test: verify Groq and PostgreSQL end to end"
```

---

## Execution Handoff

After this plan is approved, implement it with either:

- **Subagent-driven:** one fresh subagent per task, with review between tasks. Best for the PostgreSQL migration because it touches nearly every test and is easy to get subtly wrong.
- **Native:** implement the tasks in this session, then run one whole-branch review. Faster for the smaller Groq and storage tasks.

The PostgreSQL migration is the riskiest task and should be completed and fully tested before the Groq stream switch, so any database regressions are isolated.
