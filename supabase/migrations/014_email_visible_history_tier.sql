-- v7.8: email-visibility toggle events join the wholesale audit trail.
-- Widen the tier check to accept 'EMAIL_VISIBLE' (written with change_type
-- toggled_on/toggled_off by lib/wholesale.ts setVariantEmailVisible).
alter table wholesale_price_history
  drop constraint if exists wholesale_price_history_tier_check;
alter table wholesale_price_history
  add constraint wholesale_price_history_tier_check
  check (tier in ('T1','T2','RETAIL','WHOLESALE_ACTIVE','EMAIL_VISIBLE'));
