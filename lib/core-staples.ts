// Core-staples allowlist for the inventory-driven order suggestion.
//
// Items on this list bypass the profit-center "margin too thin" SKIP
// verdict — they must always be in stock regardless of unit economics.
// v2 will move this to an operator-editable Supabase table.

const CORE_STAPLE_KEYWORDS: string[] = [
  // Bananas (always have them)
  'banana',
  // Eggs + dairy
  'eggs', 'milk',
  // Aromatics + alliums
  'yellow onion', 'red onion', 'sweet onion', 'garlic',
  // Roots
  'potato', 'sweet potato', 'carrot',
  // Herbs
  'cilantro', 'parsley',
  // Citrus
  'lemon', 'lime', 'orange', 'grapefruit',
  // Apples (year-round staples)
  'apple',
  // Salad anchors
  'iceberg', 'romaine', 'celery', 'cucumber',
  // Tomatoes (always have on-vine + roma)
  'tomato',
  // Peppers
  'bell pepper',
];

/** Returns true if a product name looks like a core staple. Matches by
 *  case-insensitive substring against any keyword. */
export function isCoreStaple(productName: string | null | undefined): boolean {
  if (!productName) return false;
  const n = productName.toLowerCase();
  return CORE_STAPLE_KEYWORDS.some((kw) => n.includes(kw));
}

export { CORE_STAPLE_KEYWORDS };
