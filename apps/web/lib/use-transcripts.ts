"use client";

import type { TranscriptDTO } from "@stt/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

const PAGE_SIZE = 50;

export type TranscriptsState = {
  items: TranscriptDTO[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  rename: (transcript: TranscriptDTO) => void;
  remove: (id: string) => void;
};

/** Server-side search with a short debounce; the list stays authoritative. */
export function useTranscripts(query: string): TranscriptsState {
  const [items, setItems] = useState<TranscriptDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const search = query.trim();
    const timer = window.setTimeout(
      async () => {
        setLoading(true);
        try {
          const result = await api.listTranscripts({
            q: search || undefined,
            limit: PAGE_SIZE,
          });
          if (cancelled) return;
          setItems(result.items);
          setError(null);
        } catch {
          if (cancelled) return;
          setError("Could not load your transcripts.");
        } finally {
          if (!cancelled) setLoading(false);
        }
      },
      search ? 250 : 0,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, version]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  const rename = useCallback((transcript: TranscriptDTO) => {
    setItems((current) =>
      current.map((item) => (item.id === transcript.id ? transcript : item)),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return { items, loading, error, refresh, rename, remove };
}
