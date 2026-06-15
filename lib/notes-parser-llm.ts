/**
 * LLM-backed parser for Clark's free-form produce-order notes.
 *
 * v1 was a strict regex grammar (`add 2 cases bananas`, `skip mesclun`,
 * etc.). It hit a wall the second Clark wrote how a human actually writes
 * — "5 lbs garlic", "Pastrami?", "Guac Mitchell's", "MilK replacement A2
 *  family farmstead doesn't move". The screenshot showed 16+ ⚠ warnings.
 *
 * v2 is one Claude call per line. Output is a strict JSON action; we cache
 * by SHA-256 of the trimmed lower-cased line so re-parsing the same note
 * doesn't burn tokens.
 *
 * Cost: claude-haiku-4-5 at ~$1/M input + $5/M output. With a ~3k-token
 * prompt + ~80-token output, that's ~$0.0034 per line, ~$0.34 per 100
 * notes. Cache hits cost zero.
 */

import { createHash } from 'crypto';
import { createAdminClient } from './supabase/admin';
import { tokenize } from './loss-match';
import type { Catalog } from './notes-parser';

export type LlmAction =
  | { kind: 'add';     qty: number; unit: 'cases' | 'lb' | 'units'; sku_hint: string; confidence: 'high'|'med'|'low' }
  | { kind: 'skip';    sku_hint: string; reason: string; confidence: 'high'|'med'|'low' }
  | { kind: 'so';      customer: string; qty: number; unit: 'cases' | 'lb' | 'units'; sku_hint: string; confidence: 'high'|'med'|'low' }
  | { kind: 'note';    sku_hint: string | null; text: string; confidence: 'high'|'med'|'low' }
  | { kind: 'flag';    sku_hint: string | null; reason: string; confidence: 'high'|'med'|'low' }
  | { kind: 'ambiguous'; candidates: string[]; reason: string }
  | { kind: 'unparseable'; reason: string };

export interface LlmParsedLine {
  raw: string;
  action: LlmAction;
  /** Thrive item id bound from sku_hint via fuzzy match (null if no match). */
  bound_item_id: string | null;
  bound_item_name: string | null;
  /** Cost telemetry for the running estimate at the top of the panel. */
  source: 'cache' | 'llm';
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

const MODEL = 'claude-haiku-4-5-20251001';
const PRICE_IN_PER_MTOKEN = 1.00;   // USD per 1M input tokens
const PRICE_OUT_PER_MTOKEN = 5.00;  // USD per 1M output tokens

function hashLine(line: string): string {
  return createHash('sha256').update(line.trim().toLowerCase()).digest('hex');
}

/** Loose fuzzy bind: pick the catalog item with the most token overlap. */
function bind(skuHint: string | null, catalog: Catalog[]): { id: string | null; name: string | null } {
  if (!skuHint) return { id: null, name: null };
  const tk = tokenize(skuHint);
  if (tk.size === 0) return { id: null, name: null };
  let best: { c: Catalog; overlap: number } | null = null;
  for (const c of catalog) {
    const ck = tokenize(c.name);
    let ov = 0;
    for (const t of tk) if (ck.has(t)) ov++;
    if (ov === 0) continue;
    if (!best || ov > best.overlap) best = { c, overlap: ov };
  }
  return best ? { id: best.c.thrive_item_id, name: best.c.name } : { id: null, name: null };
}

function buildPrompt(line: string, catalog: Catalog[]): { system: string; user: string } {
  // Cap the SKU list to 150 items so the prompt doesn't bloat. Cycling
  // through every produce SKU once per call would be ~120 entries today —
  // well within Haiku's context budget.
  const skuList = catalog
    .slice(0, 200)
    .map((c) => `- ${c.name}`)
    .join('\n');

  const system = `You parse produce-ordering notes from a grocery-store owner into ONE structured JSON action.

ACTIVE PRODUCE SKUs (for sku_hint binding — pick the closest match):
${skuList}

ACTIONS (return EXACTLY ONE):
- {"kind":"add","qty":<int>,"unit":"cases"|"lb"|"units","sku_hint":"<sku name>","confidence":"high"|"med"|"low"}
- {"kind":"skip","sku_hint":"<sku name>","reason":"<short>","confidence":"high"|"med"|"low"}
- {"kind":"so","customer":"<name>","qty":<int>,"unit":"cases"|"lb"|"units","sku_hint":"<sku name>","confidence":"high"|"med"|"low"}
- {"kind":"note","sku_hint":"<sku name>" | null,"text":"<note>","confidence":"high"|"med"|"low"}
- {"kind":"flag","sku_hint":"<sku name>" | null,"reason":"<short>","confidence":"high"|"med"|"low"}
- {"kind":"ambiguous","candidates":["<sku name>", ...],"reason":"<short>"}
- {"kind":"unparseable","reason":"<short>"}

RULES:
- If qty is implicit (e.g. just "Mesclun"), use qty=1 unit=cases (case is the default produce-order unit).
- "5 lbs garlic" → qty=5 unit=lb sku_hint="garlic" confidence=high.
- "Pastrami?" with a question mark → unparseable OR ambiguous if multiple pastramis exist.
- "doesn't move" / "didn't sell" / "stop ordering" → kind=skip.
- "seek credit" / "credit please" / "short delivery" → kind=flag.
- "(if Price is decent)" / "if good" → kind=note.
- "s/o <customer>" → kind=so.
- sku_hint MUST be a substring or close fuzzy of one item from the list above.
- If the item is genuinely not in the list, set confidence="low".
- Return ONLY the JSON object. No prose, no markdown, no code fences.`;

  return { system, user: line };
}

interface AnthropicResponse {
  content: { type: string; text?: string }[];
  usage: { input_tokens: number; output_tokens: number };
}

async function callClaude(line: string, catalog: Catalog[]): Promise<{
  raw: string;
  action: LlmAction;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { system, user } = buildPrompt(line, catalog);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as AnthropicResponse;
  const text = data.content?.[0]?.text ?? '';
  const action = parseJsonAction(text);

  const cost =
    (data.usage.input_tokens * PRICE_IN_PER_MTOKEN +
      data.usage.output_tokens * PRICE_OUT_PER_MTOKEN) /
    1_000_000;

  return {
    raw: text,
    action,
    input_tokens: data.usage.input_tokens,
    output_tokens: data.usage.output_tokens,
    cost_usd: cost,
  };
}

function parseJsonAction(text: string): LlmAction {
  // Strip markdown fences if Claude included them.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === 'object' && typeof obj.kind === 'string') {
      return obj as LlmAction;
    }
  } catch {
    /* fall through */
  }
  return { kind: 'unparseable', reason: `LLM did not return valid JSON: ${cleaned.slice(0, 80)}` };
}

/** Bulk parse a textarea — caches by line hash. Empty lines are skipped. */
export async function parseNotesLlm(
  notes: string,
  catalog: Catalog[]
): Promise<{ lines: LlmParsedLine[]; totals: { cache_hits: number; llm_calls: number; total_cost_usd: number } }> {
  const lines = notes
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const admin = createAdminClient();
  const out: LlmParsedLine[] = [];
  let cacheHits = 0;
  let llmCalls = 0;
  let totalCost = 0;

  for (const line of lines) {
    const hash = hashLine(line);
    let action: LlmAction | null = null;
    let source: 'cache' | 'llm' = 'cache';
    let inputTok = 0;
    let outputTok = 0;
    let cost = 0;

    if (admin) {
      const { data } = await admin
        .from('notes_parse_cache')
        .select('result, input_tokens, output_tokens, cost_usd')
        .eq('hash', hash)
        .maybeSingle();
      if (data && data.result) {
        action = data.result as LlmAction;
        cacheHits++;
      }
    }

    if (!action) {
      try {
        const r = await callClaude(line, catalog);
        action = r.action;
        inputTok = r.input_tokens;
        outputTok = r.output_tokens;
        cost = r.cost_usd;
        source = 'llm';
        llmCalls++;
        totalCost += cost;
        if (admin) {
          await admin.from('notes_parse_cache').upsert({
            hash,
            line_excerpt: line.slice(0, 200),
            model: MODEL,
            result: action,
            input_tokens: inputTok,
            output_tokens: outputTok,
            cost_usd: cost,
          });
        }
      } catch (err) {
        action = {
          kind: 'unparseable',
          reason: err instanceof Error ? err.message : String(err),
        };
        source = 'llm';
      }
    }

    const skuHint =
      (action.kind === 'add' || action.kind === 'skip' || action.kind === 'so' || action.kind === 'note' || action.kind === 'flag')
        ? (action.sku_hint ?? null)
        : null;
    const bound = bind(skuHint, catalog);

    out.push({
      raw: line,
      action,
      bound_item_id: bound.id,
      bound_item_name: bound.name,
      source,
      input_tokens: inputTok,
      output_tokens: outputTok,
      cost_usd: cost,
    });
  }

  return {
    lines: out,
    totals: {
      cache_hits: cacheHits,
      llm_calls: llmCalls,
      total_cost_usd: Math.round(totalCost * 10000) / 10000,
    },
  };
}
