create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table private.translation_usage_limits (
  singleton boolean primary key default true check (singleton),
  daily_request_limit bigint not null check (daily_request_limit > 0),
  daily_cue_limit bigint not null check (daily_cue_limit > 0),
  daily_source_grapheme_limit bigint not null check (daily_source_grapheme_limit > 0),
  updated_at timestamptz not null default statement_timestamp()
);

revoke all on table private.translation_usage_limits from public, anon, authenticated;

create table public.translation_daily_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  request_count bigint not null default 0 check (request_count >= 0),
  cue_count bigint not null default 0 check (cue_count >= 0),
  source_grapheme_count bigint not null default 0 check (source_grapheme_count >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (user_id, usage_date)
);

alter table public.translation_daily_usage enable row level security;

revoke all on table public.translation_daily_usage from public, anon, authenticated;
grant select on table public.translation_daily_usage to authenticated;

create policy "Users can view their own translation usage"
on public.translation_daily_usage
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.reserve_translation_usage(
  p_cue_count bigint,
  p_source_grapheme_count bigint
)
returns table (
  reserved boolean,
  usage_date date,
  request_count bigint,
  cue_count bigint,
  source_grapheme_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_usage_date date := (timezone('utc', statement_timestamp()))::date;
  v_request_limit bigint;
  v_cue_limit bigint;
  v_source_grapheme_limit bigint;
  v_usage public.translation_daily_usage%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_cue_count is null or p_cue_count <= 0
    or p_source_grapheme_count is null or p_source_grapheme_count < 0 then
    raise exception 'invalid_usage_increment' using errcode = '22023';
  end if;

  select
    limits.daily_request_limit,
    limits.daily_cue_limit,
    limits.daily_source_grapheme_limit
  into
    v_request_limit,
    v_cue_limit,
    v_source_grapheme_limit
  from private.translation_usage_limits as limits
  where limits.singleton;

  if not found then
    raise exception 'translation_usage_limits_not_configured' using errcode = 'P0001';
  end if;

  if p_cue_count > v_cue_limit
    or p_source_grapheme_count > v_source_grapheme_limit then
    select usage.*
    into v_usage
    from public.translation_daily_usage as usage
    where usage.user_id = v_user_id
      and usage.usage_date = v_usage_date;

    reserved := false;
    usage_date := v_usage_date;
    request_count := coalesce(v_usage.request_count, 0);
    cue_count := coalesce(v_usage.cue_count, 0);
    source_grapheme_count := coalesce(v_usage.source_grapheme_count, 0);
    return next;
    return;
  end if;

  insert into public.translation_daily_usage as usage (
    user_id,
    usage_date,
    request_count,
    cue_count,
    source_grapheme_count
  )
  values (
    v_user_id,
    v_usage_date,
    1,
    p_cue_count,
    p_source_grapheme_count
  )
  on conflict on constraint translation_daily_usage_pkey do update
  set
    request_count = usage.request_count + 1,
    cue_count = usage.cue_count + excluded.cue_count,
    source_grapheme_count = usage.source_grapheme_count + excluded.source_grapheme_count,
    updated_at = statement_timestamp()
  where usage.request_count < v_request_limit
    and usage.cue_count <= v_cue_limit - excluded.cue_count
    and usage.source_grapheme_count <= v_source_grapheme_limit - excluded.source_grapheme_count
  returning usage.* into v_usage;

  if found then
    reserved := true;
  else
    select usage.*
    into strict v_usage
    from public.translation_daily_usage as usage
    where usage.user_id = v_user_id
      and usage.usage_date = v_usage_date;
    reserved := false;
  end if;

  usage_date := v_usage.usage_date;
  request_count := v_usage.request_count;
  cue_count := v_usage.cue_count;
  source_grapheme_count := v_usage.source_grapheme_count;
  return next;
end;
$$;

revoke all on function public.reserve_translation_usage(bigint, bigint)
from public, anon;
grant execute on function public.reserve_translation_usage(bigint, bigint)
to authenticated;
