import type { SegmentDTO, StreamEvent } from "@stt/shared";
import { refreshSession } from "@/lib/api";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
// Client ceiling for waiting on the final flush; the server owns the authoritative flush budget (STT_MAX_FINAL_COOLDOWN_WAIT_MS).
const STOP_TIMEOUT_MS =
  Number(process.env.NEXT_PUBLIC_STT_STOP_TIMEOUT_MS) || 2_000;
const RECONNECT_DELAYS_MS = (process.env.NEXT_PUBLIC_STT_RECONNECT_DELAYS_MS ??
  "500,1000,2000,5000")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
// The access cookie lives for 15 minutes; refresh well before it expires, not
// on every four-minute rotation (each refresh rotates the refresh token).
const REFRESH_AFTER_MS =
  Number(process.env.NEXT_PUBLIC_STT_REFRESH_AFTER_MS) || 10 * 60_000;

function streamUrl(transcriptId: string): string {
  if (API_URL) {
    return `${API_URL.replace(/^http/, "ws")}/transcripts/${transcriptId}/stream`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/transcripts/${transcriptId}/stream`;
}

export type LiveCallbacks = {
  onSegment: (segment: SegmentDTO) => void;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
};

/**
 * Streams 16 kHz PCM from a MediaStream to the API and surfaces finalized
 * segments. A serverless function closes its socket at the duration cap, so
 * this class reconnects without tearing down the microphone graph and refreshes
 * the session cookie before each attempt. The audio graph is only wired
 * through a muted sink so the worklet runs without echoing the microphone.
 */
export class LiveTranscriber {
  private socket: WebSocket | null = null;
  private readonly context: AudioContext;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly node: AudioWorkletNode;
  private readonly sink: GainNode;
  private readonly transcriptId: string;
  private readonly callbacks: LiveCallbacks;
  private readonly done: Promise<void>;
  private resolveDone: () => void = () => {};
  private closed = false;
  private stopping = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private rotateRequested = false;
  private reportedDisconnect = false;
  private lastRefreshAt = Date.now();
  private pendingFrames: ArrayBuffer[] = [];
  private pendingBytes = 0;

  private constructor(
    context: AudioContext,
    source: MediaStreamAudioSourceNode,
    node: AudioWorkletNode,
    sink: GainNode,
    transcriptId: string,
    callbacks: LiveCallbacks,
  ) {
    this.context = context;
    this.source = source;
    this.node = node;
    this.sink = sink;
    this.transcriptId = transcriptId;
    this.callbacks = callbacks;

    const done = Promise.withResolvers<void>();
    this.done = done.promise;
    this.resolveDone = done.resolve;

    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      this.sendOrQueue(event.data);
    };
  }

  static async start(
    stream: MediaStream,
    transcriptId: string,
    callbacks: LiveCallbacks,
  ): Promise<LiveTranscriber> {
    const context = new AudioContext({ sampleRate: 16_000 });
    try {
      await context.audioWorklet.addModule("/worklet/pcm-processor.js");
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
    }

    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "pcm-processor");
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(context.destination);

    const transcriber = new LiveTranscriber(
      context,
      source,
      node,
      sink,
      transcriptId,
      callbacks,
    );

    // Start capturing immediately; frames queue while the socket connects.
    await context.resume().catch(() => {});

    try {
      await transcriber.connect();
    } catch (error) {
      transcriber.close();
      throw error;
    }

    return transcriber;
  }

  /** Keep the first seconds of speech while the socket is cold-starting. */
  private sendOrQueue(frame: ArrayBuffer): void {
    if (this.closed || this.stopping) return;

    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(frame);
      return;
    }

    this.pendingFrames.push(frame);
    this.pendingBytes += frame.byteLength;

    const maxPendingBytes = 10 * 16_000 * 2;
    while (this.pendingBytes > maxPendingBytes && this.pendingFrames.length > 0) {
      const dropped = this.pendingFrames.shift();
      if (dropped) this.pendingBytes -= dropped.byteLength;
    }
  }

  private flushPending(): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;

    for (const frame of this.pendingFrames) socket.send(frame);
    this.pendingFrames = [];
    this.pendingBytes = 0;
  }

  private connect(): Promise<void> {
    const socket = new WebSocket(streamUrl(this.transcriptId));
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    const opened = Promise.withResolvers<void>();
    let settled = false;
    const resolveOpen = (): void => {
      if (settled) return;
      settled = true;
      opened.resolve();
    };
    const rejectOpen = (): void => {
      if (settled) return;
      settled = true;
      opened.reject(new Error("WebSocket failed"));
    };

    socket.addEventListener("open", () => {
      resolveOpen();
      if (this.stopping) socket.send(JSON.stringify({ type: "stop" }));
    });
    socket.addEventListener("error", rejectOpen);
    socket.addEventListener("close", (event) => {
      rejectOpen();
      this.handleClose(socket, event);
    });
    socket.addEventListener("message", (event) => this.handleMessage(event));

    return opened.promise;
  }

  private handleMessage(event: MessageEvent): void {
    let payload: StreamEvent;
    try {
      payload = JSON.parse(String(event.data)) as StreamEvent;
    } catch {
      return;
    }

    switch (payload.type) {
      case "ready":
        this.attempt = 0;
        this.reportedDisconnect = false;
        this.flushPending();
        break;
      case "segment":
        this.callbacks.onSegment(payload.segment);
        break;
      case "interim":
        this.callbacks.onInterim?.(payload.text);
        break;
      case "error":
        this.callbacks.onError?.(payload.message);
        break;
      case "rotate":
        this.rotateRequested = true;
        this.socket?.close();
        break;
      case "done":
        this.stopping = true;
        this.resolveDone();
        break;
    }
  }

  private handleClose(socket: WebSocket, event: CloseEvent): void {
    if (this.socket !== socket) return;
    this.socket = null;

    if (this.closed || this.stopping) {
      this.resolveDone();
      return;
    }

    // 1008 means the server refused this recording (missing, already finished,
    // or closed); reconnecting would loop forever.
    if (event.code === 1008) {
      this.stopping = true;
      this.callbacks.onError?.("Live transcription stopped.");
      this.resolveDone();
      return;
    }

    const wasRotation = this.rotateRequested;
    this.rotateRequested = false;

    if (wasRotation) {
      this.attempt = 0;
      this.scheduleReconnect(100);
      return;
    }

    if (!this.reportedDisconnect) {
      this.reportedDisconnect = true;
      this.callbacks.onError?.("Live transcription disconnected; reconnecting…");
    }

    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)] ??
      5_000;
    this.attempt += 1;
    this.scheduleReconnect(delay);
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.closed || this.stopping) return;
    this.clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.reconnect();
    }, delayMs);
  }

  private async reconnect(): Promise<void> {
    if (this.closed || this.stopping) return;

    // The access cookie only lives for 15 minutes; refresh it before the new
    // handshake so a one-hour recording can keep reconnecting.
    if (Date.now() - this.lastRefreshAt >= REFRESH_AFTER_MS) {
      if (await refreshSession()) this.lastRefreshAt = Date.now();
      if (this.closed || this.stopping) return;
    }

    try {
      await this.connect();
    } catch {
      // The close handler schedules the next attempt.
    }
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.stopping = true;
    this.clearRetry();
    this.node.port.onmessage = null;
    this.pendingFrames = [];
    this.pendingBytes = 0;

    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
    } else if (!socket) {
      this.resolveDone();
    }

    await Promise.race([
      this.done,
      new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
    ]);

    this.closed = true;
    this.disconnect();
  }

  /** Network failure or page teardown: drop the graph without waiting for a flush. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopping = true;
    this.clearRetry();
    this.node.port.onmessage = null;
    this.pendingFrames = [];
    this.pendingBytes = 0;
    this.resolveDone();
    this.disconnect();
  }

  private disconnect(): void {
    this.clearRetry();
    this.pendingFrames = [];
    this.pendingBytes = 0;
    const socket = this.socket;
    this.socket = null;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      socket.close();
    }

    this.source.disconnect();
    this.node.disconnect();
    this.sink.disconnect();
    void this.context.close().catch(() => {});
  }
}
