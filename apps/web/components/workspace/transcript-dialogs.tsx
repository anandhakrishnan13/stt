"use client";

import { renameTranscriptSchema, type TranscriptDTO } from "@stt/shared";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";

export function RenameTranscriptDialog({
  transcript,
  onClose,
  onRenamed,
}: {
  transcript: TranscriptDTO | null;
  onClose: () => void;
  onRenamed: (transcript: TranscriptDTO) => void;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!transcript) return;
    setTitle(transcript.title);
    setError(null);
  }, [transcript]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transcript) return;

    const parsed = renameTranscriptSchema.safeParse({ title });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a title");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await api.renameTranscript(transcript.id, parsed.data);
      onRenamed(result.transcript);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not rename this transcript.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={transcript !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename transcript</DialogTitle>
          <DialogDescription>Only the title changes; the audio and text stay as they are.</DialogDescription>
        </DialogHeader>
        <form id="rename-transcript-form" method="post" onSubmit={onSubmit} className="space-y-3">
          {error ? <Alert variant="error">{error}</Alert> : null}
          <div className="space-y-1.5">
            <Label htmlFor="transcript-title">Title</Label>
            <Input
              id="transcript-title"
              value={title}
              autoFocus
              maxLength={120}
              invalid={Boolean(error)}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="rename-transcript-form" loading={saving}>
            Save title
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteTranscriptDialog({
  transcript,
  onClose,
  onDeleted,
}: {
  transcript: TranscriptDTO | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (transcript) setError(null);
  }, [transcript]);

  async function onConfirm() {
    if (!transcript) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteTranscript(transcript.id);
      onDeleted(transcript.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not delete this transcript.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={transcript !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete transcript</DialogTitle>
          <DialogDescription>
            “{transcript?.title}” moves to the deleted state and disappears from your history.
          </DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="error">{error}</Alert> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="danger" loading={deleting} onClick={() => void onConfirm()}>
            Delete transcript
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
