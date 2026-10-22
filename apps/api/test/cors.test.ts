import { afterAll, expect, test } from "bun:test";

process.env.VERCEL_URL = "speech-to-text-test-deployment.vercel.app";

const { buildApp } = await import("../src/app");
const app = buildApp();
afterAll(async () => {
  await app.close();
});

test("accepts signup from the current Vercel deployment origin", async () => {
  const origin = `https://${process.env.VERCEL_URL}`;
  const response = await app.inject({
    method: "POST",
    url: "/auth/signup",
    headers: { origin },
    payload: {
      firstName: "Vercel",
      lastName: "Origin",
      email: `vercel-origin-${Date.now()}@example.com`,
      password: "CorrectHorseBatteryStaple123!",
    },
  });

  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ status: "pending_verification" });
});
