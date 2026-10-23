# Speech to Text

Multilingual (Hindi/English code-mixed) real-time speech-to-text application with live streaming transcription, persistent history, and audio playback.

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, Tailwind CSS
- **API**: Fastify 5, TypeScript, Bun
- **Database**: PostgreSQL 17 (Supabase / Docker) + Drizzle ORM
- **Speech-to-Text**: Groq Whisper (`whisper-large-v3-turbo`)
- **Audio Storage**: Supabase Storage (private bucket) / local disk
- **Auth**: Argon2id passwords, JWT access + rotating refresh cookies, email OTP

## Project Structure

```
apps/api/         Fastify REST API & WebSocket server, Drizzle ORM, auth & STT services
apps/web/         Next.js web app (chat/workspace UI, auth flows)
packages/shared/  Shared TypeScript types & Zod schemas
```

## Quickstart

### Prerequisites
- [Bun](https://bun.sh/) (v1.2+)
- Docker (for local PostgreSQL & Mailpit)
- [Groq API Key](https://console.groq.com/keys)

### Setup & Run

```bash
# 1. Install dependencies
bun install

# 2. Generate local environment files
bun run setup

# 3. Start local Postgres & Mailpit (OTP test inbox)
bun run services:up

# 4. Add your Groq API key in apps/api/.env:
#    GROQ_API_KEY=gsk_...

# 5. Run database migrations
bun run db:migrate

# 6. Start both API (:3001) and Web (:3000)
bun run dev
```

- Web App: `http://localhost:3000`
- Mailpit Web UI (local email OTPs): `http://localhost:8025`

## Key Environment Variables

### `apps/api/.env`
| Variable | Description | Default / Example |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://stt:stt@127.0.0.1:5432/stt` |
| `DATABASE_SSL` | Enable SSL for remote databases | `false` locally, `true` for Supabase |
| `GROQ_API_KEY` | Server-side Groq API key | `gsk_...` |
| `STORAGE_DRIVER` | Audio storage backend | `local` or `supabase` |
| `SUPABASE_URL` | Supabase project URL (if storage=supabase) | `https://<id>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service role key | `sb_secret_...` |
| `SMTP_URL` | Mail transport for OTP delivery | `smtp://127.0.0.1:1025` (Mailpit) |

### `apps/web/.env.local`
| Variable | Description | Default |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL of API | `http://localhost:3001` (empty in prod for same-origin) |

## How It Works

1. **Audio Streaming**: Browser captures 16 kHz mono PCM and streams it over an authenticated WebSocket (`/transcripts/:id/stream`).
2. **Real-Time Transcription**: Fastify buffers incoming audio windows and streams them to Groq's `whisper-large-v3-turbo`, persisting finalized segments to PostgreSQL and emitting real-time transcript updates.
3. **Storage & Playback**: Compressed audio chunks are assembled on completion and saved privately to Supabase Storage, streamable directly via HTTP range requests.

## Testing

```bash
bun run services:up    # ensure test database is reachable
bun run test           # run integration test suite
bun run typecheck      # typecheck all workspaces
```
