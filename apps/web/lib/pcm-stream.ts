import type { SegmentDTO, StreamEvent } from "@stt/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const STOP_TIMEOUT_MS = 8_000;

export type LiveCallbacks = {
  onSegment: (segment: SegmentDTO) => void;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
};

/**
 * Streams 16 kHz PCM from a MediaStream to the API and surfaces finalized
 * segments. The audio graph is only wired through a muted sink so the worklet
 * runs without echoing the microphone to the speakers.
 */
export class LiveTranscriber {
  private readonly socket: WebSocket;
  private readonly context: AudioContext;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly node: AudioWorkletNode;
  private readonly sink: GainNode;
  private readonly done: Promise<void>;
  private resolveDone: () => void = () => {};
  private closed = false;

  private constructor(
    socket: WebSocket,
    context: AudioContext,
    source: MediaStreamAudioSourceNode,
    node: AudioWorkletNode,
    sink: GainNode,
    callbacks: LiveCallbacks,
  ) {
    this.socket = socket;
    this.context = context;
    this.source = source;
    this.node = node;
    this.sink = sink;

    const done = Promise.withResolvers<void>();
    this.done = done.promise;
    this.resolveDone = done.resolve;
    socket.addEventListener("message", (event) => {
      let payload: StreamEvent;
      try {
        payload = JSON.parse(String(event.data)) as StreamEvent;
      } catch {
        return;
      }

      switch (payload.type) {
        case "ready":
          break;
        case "segment":
          callbacks.onSegment(payload.segment);
          break;
        case "interim":
          callbacks.onInterim?.(payload.text);
          break;
        case "error":
          callbacks.onError?.(payload.message);
          break;
        case "done":
          this.resolveDone();
          break;
      }
    });

    socket.addEventListener("close", () => this.resolveDone());
    socket.addEventListener("error", () => {
      callbacks.onError?.("Lost the transcription connection.");
      this.resolveDone();
    });

    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(event.data);
    };
  }

  static async start(
    stream: MediaStream,
    transcriptId: string,
    callbacks: LiveCallbacks,
  ): Promise<LiveTranscriber> {
    const url = `${API_URL.replace(/^http/, "ws")}/transcripts/${transcriptId}/stream`;
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";

    const context = new AudioContext({ sampleRate: 16_000 });
    try {
      await context.audioWorklet.addModule("/worklet/pcm-processor.js");
    } catch (error) {
      socket.close();
      await context.close();
      throw error;
    }

    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "pcm-processor");
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(context.destination);

    const transcriber = new LiveTranscriber(socket, context, source, node, sink, callbacks);

    if (socket.readyState === WebSocket.CONNECTING) {
      const opened = Promise.withResolvers<void>();
      socket.addEventListener("open", () => opened.resolve(), { once: true });
      socket.addEventListener("error", () => opened.reject(new Error("WebSocket failed")), {
        once: true,
      });
      await opened.promise;
    }

    await context.resume().catch(() => {});
    return transcriber;
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.node.port.onmessage = null;

    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "stop" }));
    }

    await Promise.race([
      this.done,
      new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
    ]);

    this.disconnect();
  }

  /** Network failure or page teardown: drop the graph without waiting for a flush. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.node.port.onmessage = null;
    this.disconnect();
  }

  private disconnect(): void {
    this.source.disconnect();
    this.node.disconnect();
    this.sink.disconnect();
    void this.context.close().catch(() => {});
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
    else if (this.socket.readyState === WebSocket.CONNECTING) this.socket.close();
  }
}
