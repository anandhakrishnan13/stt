-- Run once after migrations against the Supabase database.
-- The API connects as the table owner, which bypasses RLS. Browser clients
-- using the publishable/anon key get no access because there are no policies.
alter table public.users enable row level security;
alter table public.refresh_tokens enable row level security;
alter table public.email_otps enable row level security;
alter table public.transcripts enable row level security;
alter table public.segments enable row level security;
alter table public.audit_events enable row level security;

revoke all on table public.users from anon, authenticated;
revoke all on table public.refresh_tokens from anon, authenticated;
revoke all on table public.email_otps from anon, authenticated;
revoke all on table public.transcripts from anon, authenticated;
revoke all on table public.segments from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;
