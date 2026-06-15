-- Per-vendor truck-cadence buffer.
--
-- Two layers, in priority order:
--   1. target_dos_overrides[<order_day>]   -- explicit per-weekday override
--   2. gap_to_next_truck × target_buffer_multiplier
--
-- Clark's Albert's targets come from the override layer:
--   Mon order  → 5.5d  (cover Mon→Thu PLUS weekend surge)
--   Thu order  → 5.0d  (cover Thu→Mon)
--
-- A simple multiplier on a single gap can't express that asymmetry
-- (Mon→Thu is 3d, Thu→Mon is 4d — naive multiplier would put MORE cover
-- on the Thu order, the opposite of what Clark wants). The overrides
-- table-of-targets keyed by `order_day` (the day the order ships) solves it.

ALTER TABLE produce_vendors
  ADD COLUMN IF NOT EXISTS target_buffer_multiplier numeric NOT NULL DEFAULT 1.5;

ALTER TABLE produce_vendors
  ADD COLUMN IF NOT EXISTS target_dos_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN produce_vendors.target_buffer_multiplier IS
  'Cushion factor applied to truck-cadence gap to derive target days-of-supply when no per-day override is set. Default 1.5x.';

COMMENT ON COLUMN produce_vendors.target_dos_overrides IS
  'Per-order-day target DoS override, keyed by lowercase weekday (mon, tue, wed, thu, fri, sat, sun). Wins over target_buffer_multiplier when set. Example: {"mon": 5.5, "thu": 5.0}';

-- Seed Albert's with the targets Clark approved.
UPDATE produce_vendors
   SET target_dos_overrides = jsonb_build_object('mon', 5.5, 'thu', 5.0)
 WHERE display_name ILIKE '%albert%';
