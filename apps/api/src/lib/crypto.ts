import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";
import { env } from "../env";

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hmacOtp(code: string): string {
  return createHmac("sha256", env.OTP_PEPPER).update(code, "utf8").digest("hex");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Defaults match Bun.password so existing hashes stay valid. */
function argon2Options() {
  return {
    parallelism: env.ARGON2_PARALLELISM,
    iterations: env.ARGON2_ITERATIONS,
    memorySize: env.ARGON2_MEMORY_KIB,
    hashLength: env.ARGON2_HASH_LENGTH,
  };
}

export function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    ...argon2Options(),
    outputType: "encoded",
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/** Equalizes timing for unknown accounts: always burn one argon2 verification. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomToken());
  await verifyPassword(password, await dummyHash);
  return false;
}
