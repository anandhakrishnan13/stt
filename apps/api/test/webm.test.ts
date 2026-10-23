import { describe, expect, test } from "bun:test";
import { injectWebmDuration } from "../src/lib/webm";

describe("injectWebmDuration", () => {
  test("returns original source if too short", () => {
    const short = new Uint8Array([1, 2, 3]);
    expect(injectWebmDuration(short, 1000)).toBe(short);
  });

  test("returns original source if durationMs is non-positive", () => {
    const bytes = new Uint8Array(50);
    expect(injectWebmDuration(bytes, 0)).toBe(bytes);
    expect(injectWebmDuration(bytes, -5)).toBe(bytes);
  });

  test("injects Duration element into WebM Segment Info header", () => {
    // Construct minimal WebM header:
    // EBML header (10 bytes) + Segment (4 bytes ID + 8 bytes size) + Info (4 bytes ID + 1 byte size + 16 bytes payload)
    const infoPayload = new Uint8Array([
      // TimecodeScale ID: 0x2a 0xd7 0xb1, size 0x83, value 1,000,000 (0x0f4240)
      0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40,
      // MuxingApp ID: 0x4d 0x80, size 0x86, "Chrome"
      0x4d, 0x80, 0x86, 0x43, 0x68, 0x72, 0x6f, 0x6d, 0x65,
    ]);

    const header = new Uint8Array([
      // EBML ID: 1A 45 DF A3
      0x1a, 0x45, 0xdf, 0xa3, 0x85, 0x42, 0x86, 0x81, 0x01, 0x00,
      // Segment ID: 18 53 80 67, size unknown (0x01, 0xFF...)
      0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      // Info ID: 15 49 A9 66, size: 0x80 | infoPayload.length
      0x15, 0x49, 0xa9, 0x66, 0x80 | infoPayload.length,
    ]);

    const fullSource = new Uint8Array(header.length + infoPayload.length);
    fullSource.set(header, 0);
    fullSource.set(infoPayload, header.length);

    const patched = injectWebmDuration(fullSource, 30000); // 30s
    expect(patched.length).toBe(fullSource.length + 11);

    // Verify Duration element (0x44 0x89) is present in patched output
    let foundDur = false;
    for (let i = 0; i < patched.length - 11; i++) {
      if (patched[i] === 0x44 && patched[i + 1] === 0x89 && patched[i + 2] === 0x88) {
        foundDur = true;
        const dv = new DataView(patched.buffer, patched.byteOffset + i + 3, 8);
        expect(dv.getFloat64(0, false)).toBe(30000);
        break;
      }
    }
    expect(foundDur).toBe(true);
  });
});
