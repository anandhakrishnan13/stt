// @ts-nocheck
import { expect, test } from "bun:test";

process.env.NEXT_PUBLIC_API_URL = "http://localhost:3001";

const events: string[] = [];
const sent: ArrayBuffer[] = [];

let resumeContext!: () => void;
const resumeGate = new Promise<void>((resolve) => {
  resumeContext = resolve;
});

class MockAudioContext {
  sampleRate = 16_000;
  destination = {};
  audioWorklet = {
    addModule: async () => {
      events.push("module");
    },
  };

  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }

  createGain() {
    return { gain: { value: 0 }, connect() {}, disconnect() {} };
  }

  async resume() {
    events.push("resume");
    await resumeGate;
  }

  async close() {}
}

class MockAudioWorkletNode {
  port = { onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null };

  constructor() {
    (globalThis as any).__lastWorkletNode = this;
  }

  connect() {}
  disconnect() {}
}

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  binaryType = "blob";
  private listeners = new Map<string, Set<(event: any) => void>>();

  constructor() {
    events.push("socket");
    (globalThis as any).__lastSocket = this;
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.emit("open", {});
    }, 0);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  send(data: string | ArrayBuffer) {
    if (typeof data !== "string") sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { code: 1000 });
  }

  emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

globalThis.AudioContext = MockAudioContext;
globalThis.AudioWorkletNode = MockAudioWorkletNode;
globalThis.WebSocket = MockWebSocket;

const { LiveTranscriber } = await import("./pcm-stream");

test("starts capturing before the socket connects and flushes queued PCM on ready", async () => {
  const start = LiveTranscriber.start({} as MediaStream, "transcript-id", {
    onSegment() {},
  });

  await Promise.resolve();
  await Promise.resolve();

  expect(events).toContain("resume");
  expect(events).not.toContain("socket");

  const frame = new Int16Array(1600).buffer;
  const node = (globalThis as any).__lastWorkletNode as MockAudioWorkletNode;
  node.port.onmessage?.({ data: frame } as MessageEvent<ArrayBuffer>);

  resumeContext();
  const transcriber = await start;
  expect(sent).toHaveLength(0);

  const socket = (globalThis as any).__lastSocket as MockWebSocket;
  socket.emit("message", { data: JSON.stringify({ type: "ready" }) });
  expect(sent).toEqual([frame]);

  transcriber.close();
});
