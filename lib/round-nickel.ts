/**
 * Pricing rule: every COMPUTED / SUGGESTED retail price rounds to the nearest
 * five-cent increment. Mirrors the rule in
 * `feedback_retail_price_rounding.md`. **Does NOT apply to "Now price"** — the
 * literal live Thrive catalog retail. Only to suggestions.
 *
 *   roundToNickel(2.43) === 2.45
 *   roundToNickel(2.42) === 2.40
 *   roundToNickel(0)    === 0
 */
export function roundToNickel(dollars: number): number {
  if (!isFinite(dollars) || dollars <= 0) return dollars;
  return Math.round(dollars * 20) / 20;
}

/** Convert integer cents → dollars and snap to nickel in one step. */
export function centsToNickelDollars(cents: number | null | undefined): number {
  if (cents == null || !isFinite(cents)) return 0;
  return roundToNickel(cents / 100);
}
