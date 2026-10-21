import { appendFile, mkdir, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "../env";

/**
 * Chunks arrive one request at a time while the browser is recording. They are
 * appended to a local staging file, then promoted to the configured object
 * storage on finish. Staging never touches the public storage driver.
 */
function stagingPath(transcriptId: string): string {
  const safe = transcriptId.replace(/[^0-9a-f-]/gi, "");
  return resolve(env.STORAGE_DIR, "tmp", `${safe}.part`);
}

export async function appendChunk(transcriptId: string, chunk: Uint8Array): Promise<number> {
  const target = stagingPath(transcriptId);
  await mkdir(resolve(env.STORAGE_DIR, "tmp"), { recursive: true });
  await appendFile(target, chunk, { mode: 0o600 });
  const info = await stat(target);
  return info.size;
}

export async function stagedBytes(transcriptId: string): Promise<number> {
  const info = await stat(stagingPath(transcriptId)).catch(() => null);
  return info?.size ?? 0;
}

export async function readStaged(transcriptId: string): Promise<Uint8Array> {
  const file = Bun.file(stagingPath(transcriptId));
  return new Uint8Array(await file.arrayBuffer());
}

export async function discardStaged(transcriptId: string): Promise<void> {
  await unlink(stagingPath(transcriptId)).catch(() => {});
}
