"use client";

import { useEffect, useRef } from "react";

type AudioWaveProps = {
  stream: MediaStream | null;
  className?: string;
};

export function AudioWave({ stream, className = "" }: AudioWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!stream) return;

    let animationFrameId: number;
    let audioContext: AudioContext | null = null;

    try {
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const numBars = 18;

      function render() {
        if (!canvas || !ctx) return;
        analyser.getByteFrequencyData(dataArray);

        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);

        const gap = 3;
        const barWidth = (width - (numBars - 1) * gap) / numBars;

        // Check if there is actual sound
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] ?? 0;
        }
        const average = sum / bufferLength;
        const isSpeaking = average > 8; // Threshold for active speech vs idle noise

        for (let i = 0; i < numBars; i++) {
          // Sample frequencies symmetrically from middle
          const binIndex = Math.floor((Math.abs(i - numBars / 2) / (numBars / 2)) * (bufferLength / 2));
          const val = dataArray[binIndex] ?? 0;

          // If silent: calm 3px dot/bar; if speaking: scales up with voice amplitude
          const scale = isSpeaking ? Math.min(1, Math.max(0.08, val / 255)) : 0.08;
          const barHeight = Math.max(3, scale * (height - 4));

          const x = i * (barWidth + gap);
          const y = (height - barHeight) / 2;

          // Color: vibrant rose/pink when speaking, muted rose when silent
          ctx.fillStyle = isSpeaking ? "rgb(244, 63, 94)" : "rgba(244, 63, 94, 0.4)";
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, 2);
          ctx.fill();
        }

        animationFrameId = requestAnimationFrame(render);
      }

      render();
    } catch {
      // AudioContext not supported or blocked
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close().catch(() => {});
      }
    };
  }, [stream]);

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={32}
      className={`h-8 w-40 shrink-0 ${className}`}
    />
  );
}
