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
  updated_at = statement_timestamp()
where (
  translation_usage_limits.daily_request_limit,
  translation_usage_limits.daily_cue_limit,
  translation_usage_limits.daily_source_grapheme_limit
) is distinct from (
  excluded.daily_request_limit,
  excluded.daily_cue_limit,
  excluded.daily_source_grapheme_limit
);
