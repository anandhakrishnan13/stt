import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

/**
 * Creates the per-app env files from their examples, generating the two
 * secrets the API refuses to start without. Never overwrites existing files.
 */
const root = new URL("..", import.meta.url).pathname;
const secret = () => randomBytes(48).toString("base64");

const targets = [
  {
    example: `${root}apps/api/.env.example`,
    target: `${root}apps/api/.env`,
    transform: (content: string) =>
      content
        .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret()}`)
        .replace(/^OTP_PEPPER=.*$/m, `OTP_PEPPER=${secret()}`),
  },
  {
    example: `${root}apps/web/.env.example`,
    target: `${root}apps/web/.env.local`,
    transform: (content: string) => content,
  },
];

for (const { example, target, transform } of targets) {
  if (existsSync(target)) {
    console.log(`keep  ${target.replace(root, "")} (already exists)`);
    continue;
  }
  writeFileSync(target, transform(readFileSync(example, "utf8")), { mode: 0o600 });
  console.log(`write ${target.replace(root, "")}`);
}
