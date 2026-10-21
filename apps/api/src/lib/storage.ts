import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { env } from "../env";

export type AudioObject = {
  key: string;
  contentType: string;
  bytes: Uint8Array;
};

export type AudioRange = { start: number; end: number };

export type AudioStream = {
  status: 200 | 206;
  body: ReadableStream<Uint8Array>;
  headers: Record<string, string>;
};

export interface StorageDriver {
  readonly name: string;
  put(object: AudioObject): Promise<void>;
  remove(key: string): Promise<void>;
  size(key: string): Promise<number | null>;
  read(key: string, range?: AudioRange): Promise<AudioStream | null>;
}

const KEY_RE = /^audio\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webm|m4a|ogg)$/;

export function assertStorageKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error(`Refusing unsafe storage key: ${key}`);
}

class LocalStorage implements StorageDriver {
  readonly name = "local";
  private readonly base = resolve(env.STORAGE_DIR, "objects");

  private path(key: string): string {
    assertStorageKey(key);
    return resolve(this.base, key);
  }

  async put(object: AudioObject): Promise<void> {
    const target = this.path(object.key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, object.bytes, { mode: 0o600 });
  }

  async remove(key: string): Promise<void> {
    await unlink(this.path(key)).catch(() => {});
  }

  async size(key: string): Promise<number | null> {
    const info = await stat(this.path(key)).catch(() => null);
    return info?.size ?? null;
  }

  async read(key: string, range?: AudioRange): Promise<AudioStream | null> {
    const target = this.path(key);
    const info = await stat(target).catch(() => null);
    if (!info) return null;

    // Content type is owned by the transcript row, not the object store.
    const headers: Record<string, string> = { "accept-ranges": "bytes" };

    if (!range) {
      const file = Bun.file(target);
      return {
        status: 200,
        body: file.stream(),
        headers: { ...headers, "content-length": String(info.size) },
      };
    }

    const blob = Bun.file(target).slice(range.start, range.end + 1);
    return {
      status: 206,
      body: blob.stream(),
      headers: {
        ...headers,
        "content-length": String(blob.size),
        "content-range": `bytes ${range.start}-${range.end}/${info.size}`,
      },
    };
  }
}

class SupabaseStorage implements StorageDriver {
  readonly name = "supabase";
  private readonly base = `${env.SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object`;
  private readonly auth = {
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  };

  private url(key: string): string {
    assertStorageKey(key);
    return `${this.base}/${env.SUPABASE_BUCKET}/${key}`;
  }

  async put(object: AudioObject): Promise<void> {
    const response = await fetch(this.url(object.key), {
      method: "POST",
      headers: {
        ...this.auth,
        "content-type": object.contentType,
        "cache-control": "private, max-age=0",
        "x-upsert": "true",
      },
      body: object.bytes,
    });
    if (!response.ok) {
      throw new Error(`Supabase upload failed: ${response.status} ${await response.text()}`);
    }
  }

  async remove(key: string): Promise<void> {
    await fetch(this.url(key), { method: "DELETE", headers: this.auth }).catch(() => {});
  }

  async size(key: string): Promise<number | null> {
    const response = await fetch(this.url(key), { method: "HEAD", headers: this.auth });
    if (response.status === 404) return null;
    const length = Number(response.headers.get("content-length"));
    return Number.isFinite(length) ? length : null;
  }

  async read(key: string, range?: AudioRange): Promise<AudioStream | null> {
    const headers: Record<string, string> = { ...this.auth };
    if (range) headers.range = `bytes=${range.start}-${range.end}`;

    const response = await fetch(this.url(key), { headers });
    if (response.status === 404) return null;
    if (response.status !== 200 && response.status !== 206) {
      throw new Error(`Supabase download failed: ${response.status}`);
    }

    const passthrough: Record<string, string> = {};
    for (const header of ["content-length", "content-range", "accept-ranges"]) {
      const value = response.headers.get(header);
      if (value) passthrough[header] = value;
    }

    return {
      status: response.status === 206 ? 206 : 200,
      body: response.body ?? new ReadableStream({ start: (controller) => controller.close() }),
      headers: passthrough,
    };
  }
}

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (!driver) {
    driver = env.STORAGE_DRIVER === "supabase" ? new SupabaseStorage() : new LocalStorage();
  }
  return driver;
}

export async function readWholeFile(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}
