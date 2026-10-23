"use client";

import { useEffect, useRef, useState } from "react";

const TICK_MS = 20;
const CATCH_UP_BACKLOG = 80;

/**
 * Reveals text one character at a time. When the target grows faster than the
 * reveal rate (a long segment arrives), it speeds up instead of falling behind.
 * Disabling it, or a reduced-motion preference, snaps straight to the full text.
 */
export function useTypewriter(target: string, enabled: boolean): string {
  const [visible, setVisible] = useState(() => (enabled ? 0 : target.length));
  const targetRef = useRef(target);
  targetRef.current = target;
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
  }, []);

  // A revised segment can rewrite the paragraph instead of extending it. Snap
  // forward in that case rather than typing over already-correct text.
  useEffect(() => {
    setVisible((current) => {
      if (!enabled || reducedMotionRef.current) return target.length;
      const shown = target.slice(0, current);
      return target.startsWith(shown) ? Math.min(current, target.length) : target.length;
    });
  }, [target, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const timer = window.setInterval(() => {
      setVisible((current) => {
        if (reducedMotionRef.current) return targetRef.current.length;

        const full = targetRef.current;
        if (current >= full.length) return current;

        const backlog = full.length - current;
        const step = backlog > CATCH_UP_BACKLOG ? Math.ceil(backlog / 20) : 1;
        return Math.min(full.length, current + step);
      });
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [enabled]);

  return enabled ? target.slice(0, visible) : target;
}
