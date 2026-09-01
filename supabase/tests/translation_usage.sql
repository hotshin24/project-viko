begin;

insert into private.translation_usage_limits (
  singleton,
  daily_request_limit,
  daily_cue_limit,
  daily_source_grapheme_limit
)
values (true, 10, 500, 20000)
on conflict (singleton) do update
set
  daily_request_limit = excluded.daily_request_limit,
  daily_cue_limit = excluded.daily_cue_limit,
  daily_source_grapheme_limit = excluded.daily_source_grapheme_limit,
  updated_at = statement_timestamp();

do $$
declare
  test_user_id uuid;
begin
  select id into test_user_id
  from auth.users
  order by created_at
  limit 1;

  if test_user_id is null then
    raise exception 'DB test requires one existing Auth user';
  end if;

  perform set_config('request.jwt.claim.sub', test_user_id::text, true);
end;
$$;

set local role authenticated;

do $$
declare
  first_reservation record;
  boundary_reservation record;
  rejected_reservation record;
  visible_rows bigint;
  reservation_number integer;
begin
  if (select auth.uid()) is null then
    raise exception 'DB test requires one existing Auth user';
  end if;

  select * into strict first_reservation
  from public.reserve_translation_usage(1, 1);
  if not first_reservation.reserved
    or first_reservation.usage_date <> (timezone('utc', statement_timestamp()))::date
    or first_reservation.request_count <> 1
    or first_reservation.cue_count <> 1
    or first_reservation.source_grapheme_count <> 1 then
    raise exception 'first reservation assertion failed';
  end if;

  for reservation_number in 2..9 loop
    perform public.reserve_translation_usage(1, 1);
  end loop;

  select * into strict boundary_reservation
  from public.reserve_translation_usage(491, 19991);
  if not boundary_reservation.reserved
    or boundary_reservation.request_count <> 10
    or boundary_reservation.cue_count <> 500
    or boundary_reservation.source_grapheme_count <> 20000 then
    raise exception 'exact limit reservation assertion failed';
  end if;

  select * into strict rejected_reservation
  from public.reserve_translation_usage(1, 1);
  if rejected_reservation.reserved
    or rejected_reservation.request_count <> 10
    or rejected_reservation.cue_count <> 500
    or rejected_reservation.source_grapheme_count <> 20000 then
    raise exception 'over-limit reservation changed usage';
  end if;

  select count(*) into visible_rows
  from public.translation_daily_usage;
  if visible_rows <> 1 then
    raise exception 'RLS own-row visibility assertion failed';
  end if;

  if has_table_privilege('authenticated', 'public.translation_daily_usage', 'INSERT')
    or has_table_privilege('authenticated', 'public.translation_daily_usage', 'UPDATE')
    or has_table_privilege('authenticated', 'public.translation_daily_usage', 'DELETE') then
    raise exception 'authenticated has direct write privilege';
  end if;

end;
$$;

reset role;

do $$
declare
  public_execute boolean;
begin
  if has_table_privilege('authenticated', 'private.translation_usage_limits', 'SELECT')
    or has_table_privilege('authenticated', 'private.translation_usage_limits', 'INSERT')
    or has_table_privilege('authenticated', 'private.translation_usage_limits', 'UPDATE')
    or has_table_privilege('authenticated', 'private.translation_usage_limits', 'DELETE') then
    raise exception 'authenticated can access private limits';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.reserve_translation_usage(1, 1);
    raise exception 'function accepted missing auth.uid()';
  exception
    when insufficient_privilege then null;
  end;

  select exists (
    select 1
    from aclexplode(coalesce(
      routine.proacl,
      acldefault('f', routine.proowner)
    )) as privilege
    where privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  )
  into public_execute
  from pg_proc as routine
  join pg_namespace as namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'public'
    and routine.proname = 'reserve_translation_usage'
    and pg_get_function_identity_arguments(routine.oid) = 'p_cue_count bigint, p_source_grapheme_count bigint';

  if public_execute
    or has_function_privilege(
      'anon',
      'public.reserve_translation_usage(bigint, bigint)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.reserve_translation_usage(bigint, bigint)',
      'EXECUTE'
    ) then
    raise exception 'function execute privilege assertion failed';
  end if;

  if not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'translation_daily_usage'
      and relation.relrowsecurity
  ) then
    raise exception 'RLS is not enabled';
  end if;

  if not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'translation_usage_limits'
      and relation.relrowsecurity
  ) then
    raise exception 'private limits RLS is not enabled';
  end if;
end;
$$;

rollback;
