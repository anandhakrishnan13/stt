import type { SegmentDTO } from "@stt/shared";
import { api } from "@/lib/api";
import { LiveTranscriber } from "@/lib/pcm-stream";
import { TRANSCRIPTS_CHANGED } from "@/lib/transcripts";

/**
 * MediaRecorder compresses the archived audio to Opus (or AAC on Safari), so
 * those chunks are uploaded verbatim. In parallel, the mic graph emits 16 kHz
 * PCM over a WebSocket for live transcription; the two paths share one stream.
 */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

const CHUNK_INTERVAL_MS =
  Number(process.env.NEXT_PUBLIC_RECORDING_CHUNK_INTERVAL_MS) || 1_000;
const MAX_DURATION_MS =
  Number(process.env.NEXT_PUBLIC_RECORDING_MAX_DURATION_MS) || 60 * 60 * 1_000;
const AUDIO_BITS_PER_SECOND =
  Number(process.env.NEXT_PUBLIC_RECORDING_AUDIO_BITS_PER_SECOND) || 24_000;

export class RecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingError";
  }
}

export function preferredMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function describeMediaError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Microphone access was blocked. Allow it and retry.";
    if (error.name === "NotFoundError") return "No microphone was found.";
    if (error.name === "NotReadableError") return "The microphone is busy in another app.";
  }
  return "Could not start recording. Check your microphone and retry.";
}

export type RecordingResult = { id: string; durationMs: number };

export type RecordingCallbacks = {
  onSegment?: (segment: SegmentDTO) => void;
  onInterim?: (text: string) => void;
  onTranscriptionError?: (message: string) => void;
  engine?: "whisper" | "gemini";
};

export class VoiceRecorder {
  private readonly stream: MediaStream;
  private readonly recorder: MediaRecorder;
  private readonly transcriptId: string;
  private readonly startedAt = Date.now();
  private uploadChain: Promise<void> = Promise.resolve();
  private uploadFailure: Error | null = null;
  private seq = 0;
  private stopped = false;
  private live: LiveTranscriber | null = null;

  private constructor(stream: MediaStream, recorder: MediaRecorder, transcriptId: string) {
    this.stream = stream;
    this.recorder = recorder;
    this.transcriptId = transcriptId;
  }

  static async start(callbacks: RecordingCallbacks = {}): Promise<VoiceRecorder> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new RecordingError("This browser cannot record audio.");
    }
    if (typeof MediaRecorder === "undefined") {
      throw new RecordingError("This browser does not support MediaRecorder.");
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      throw new RecordingError(describeMediaError(error));
    }

    const mimeType = preferredMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
        ...(mimeType ? { mimeType } : {}),
      });
    } catch {
      for (const track of stream.getTracks()) track.stop();
      throw new RecordingError("This browser cannot encode the microphone stream.");
    }

    const actualMime = recorder.mimeType || mimeType || "audio/webm";

    try {
      const created = await api.startRecording(actualMime, callbacks.engine);
      const instance = new VoiceRecorder(stream, recorder, created.transcript.id);
      instance.attach();
      recorder.start(CHUNK_INTERVAL_MS);

      // Archive upload and live transcription both consume the same stream.
      instance.live = await LiveTranscriber.start(stream, created.transcript.id, {
        onSegment: callbacks.onSegment ?? (() => {}),
        onInterim: callbacks.onInterim,
        onError: callbacks.onTranscriptionError,
      }).catch(() => {
        callbacks.onTranscriptionError?.("Live transcription is unavailable; audio is still recording.");
        return null;
      });

      return instance;
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      throw error instanceof RecordingError
        ? error
        : new RecordingError("The server refused to open a recording.");
    }
  }

  get elapsedMs(): number {
    return Math.min(Date.now() - this.startedAt, MAX_DURATION_MS);
  }

  get id(): string {
    return this.transcriptId;
  }

  private attach(): void {
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size === 0) return;
      const seq = this.seq++;
      const chunk = event.data;
      // Requests must leave in chunk order: the API rejects gaps.
      this.uploadChain = this.uploadChain.then(
        () => this.upload(seq, chunk),
        () => this.upload(seq, chunk),
      );
    });
  }

  /** One retry, because a single dropped 1-second chunk otherwise breaks the file. */
  private async upload(seq: number, chunk: Blob): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await api.uploadChunk(this.transcriptId, seq, chunk);
        return;
      } catch (error) {
        if (attempt === 1) {
          this.uploadFailure = new RecordingError(
            error instanceof Error && error.message
              ? `Upload failed: ${error.message}`
              : "Upload failed.",
          );
        }
      }
    }
  }

  private stopRecorder(): Promise<void> {
    if (this.stopped || this.recorder.state === "inactive") {
      this.stopped = true;
      return Promise.resolve();
    }
    this.stopped = true;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.recorder.addEventListener("stop", () => resolve(), { once: true });
    this.recorder.stop();
    return promise;
  }

  private releaseStream(): void {
    for (const track of this.stream.getTracks()) track.stop();
  }

  async stop(): Promise<RecordingResult> {
    const durationMs = this.elapsedMs;
    await this.stopRecorder();
    await this.uploadChain;
    this.releaseStream();
    await this.live?.stop();
    this.live = null;

    if (this.uploadFailure) {
      await api.abortRecording(this.transcriptId).catch(() => {});
      throw this.uploadFailure;
    }

    const result = await api.finishRecording(this.transcriptId, durationMs);
    window.dispatchEvent(new Event(TRANSCRIPTS_CHANGED));
    return { id: result.transcript.id, durationMs: result.transcript.durationMs };
  }

  async cancel(): Promise<void> {
    await this.stopRecorder();
    await this.uploadChain;
    this.live?.close();
    this.live = null;
    this.releaseStream();
    await api.abortRecording(this.transcriptId).catch(() => {});
    window.dispatchEvent(new Event(TRANSCRIPTS_CHANGED));
  }
}
