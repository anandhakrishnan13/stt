-- Run once against the Supabase database (session pooler is fine).
-- Requires the pg_cron extension, which Supabase provides.
--
-- A recording that stays in `recording` for more than two hours was abandoned:
-- the UI caps recordings at one hour, so no live session can legitimately reach
-- this age. Delete its staged chunks and mark it failed.

create extension if not exists pg_cron;

create or replace function public.cleanup_abandoned_recordings()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from recording_chunks
  where transcript_id in (
    select id from transcripts
    where status = 'recording'
      and created_at < now() - interval '2 hours'
  );

  update transcripts
  set status = 'failed',
      ended_at = now(),
      updated_at = now()
  where status = 'recording'
    and created_at < now() - interval '2 hours';
end;
$$;

comment on function public.cleanup_abandoned_recordings()
  is 'Deletes staged chunks and fails recordings abandoned for more than two hours.';

-- Make the script idempotent: replace any previous schedule with this name.
do $$
begin
  perform cron.unschedule('cleanup-abandoned-recordings');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'cleanup-abandoned-recordings',
  '15 * * * *',
  $$select public.cleanup_abandoned_recordings();$$
);
