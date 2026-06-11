// Audience-tagged Decision shape — the TS twin of pipeline/decide.py.
//
// The order pipeline produces one Decision per line. Each carries notes
// split by who reads them:
//   supplier_facing → goes into the Albert's order email Notes column
//   internal_po     → goes into the Thrive PO line memo (private)
//   both            → goes into BOTH surfaces verbatim
// The legacy `user_note: string` is preserved as a fallback so old
// JSONL records and the original Python pipeline keep working through
// the migration.

export interface FeatureSnapshot {
  name: string;
  insufficient_data?: boolean;
  reason?: string;
  source_n?: number;
  value?: Record<string, unknown>;
}

export interface Decision {
  /** SKU on the Albert's pricelist that won the match */
  sku: string;
  item_name: string;
  description: string;

  /** What the handwritten list asked for */
  requested_qty: number;
  /** What we'll actually order */
  final_qty: number;

  bid_price: number | null;
  include_as_filler: boolean;
  drop: boolean;
  drop_reason: string;

  /** Legacy single-audience field. Used as fallback if the audience-tagged
   * lists are empty.  */
  user_note: string;

  /** Reasoning bullets for the decision_log */
  rationale: string[];

  /** Snapshot of feature values at decision time */
  features: Record<string, FeatureSnapshot>;

  /** Audience-tagged note bullets */
  supplier_facing: string[];
  internal_po: string[];
  both: string[];
}

/** Render the supplier-visible note for the email table. */
export function supplierNoteText(d: Decision): string {
  const bullets = [...d.both, ...d.supplier_facing];
  if (bullets.length) return bullets.join(' | ');
  return d.user_note ?? '';
}

/** Render the internal-only note for the Thrive PO memo. */
export function internalPoText(d: Decision): string {
  const bullets = [...d.both, ...d.internal_po];
  return bullets.join(' | ');
}

/** Build a fresh Decision skeleton with required defaults. */
export function newDecision(init: Partial<Decision> & Pick<Decision, 'sku' | 'item_name' | 'description' | 'requested_qty' | 'final_qty'>): Decision {
  return {
    bid_price: null,
    include_as_filler: false,
    drop: false,
    drop_reason: '',
    user_note: '',
    rationale: [],
    features: {},
    supplier_facing: [],
    internal_po: [],
    both: [],
    ...init,
  };
}
