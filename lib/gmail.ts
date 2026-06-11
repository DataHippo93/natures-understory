// Gmail API client — server-side only. Reads pricelist + invoice emails
// from naturesstorehouse@gmail.com via OAuth refresh token.
//
// Env required:
//   GMAIL_OAUTH_CREDENTIALS  — full Google OAuth client credentials JSON (string)
//   GMAIL_TOKEN_JSON         — the OAuth refresh token JSON for the inbox
//
// The token+credentials live in BWS today (NATURES_GMAIL_*); deployment
// step copies them into Vercel env vars.

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_TIMEOUT_MS = 20_000;

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;       // ms epoch
  payload: GmailPart;
  raw?: string;
}

export interface GmailPart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

interface OAuthCreds {
  installed?: { client_id: string; client_secret: string };
  web?:       { client_id: string; client_secret: string };
}

interface OAuthToken {
  refresh_token: string;
}

function getCreds(): { clientId: string; clientSecret: string; refreshToken: string } {
  const credsRaw = process.env.GMAIL_OAUTH_CREDENTIALS;
  const tokenRaw = process.env.GMAIL_TOKEN_JSON;
  if (!credsRaw || !tokenRaw) {
    throw new Error('Gmail credentials not configured (GMAIL_OAUTH_CREDENTIALS and GMAIL_TOKEN_JSON)');
  }
  const creds: OAuthCreds = JSON.parse(credsRaw);
  const inner = creds.installed ?? creds.web;
  if (!inner) throw new Error('GMAIL_OAUTH_CREDENTIALS missing installed/web');
  const tok: OAuthToken = JSON.parse(tokenRaw);
  if (!tok.refresh_token) throw new Error('GMAIL_TOKEN_JSON missing refresh_token');
  return { clientId: inner.client_id, clientSecret: inner.client_secret, refreshToken: tok.refresh_token };
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) {
    return cachedAccessToken.token;
  }
  const { clientId, clientSecret, refreshToken } = getCreds();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Gmail token refresh failed: ${r.status} ${text.slice(0, 200)}`);
  }
  const data = (await r.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedAccessToken.token;
}

async function gmailGet<T>(path: string): Promise<T> {
  const tok = await getAccessToken();
  const r = await fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Gmail GET ${path}: ${r.status} ${text.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

export async function searchMessages(query: string, maxResults = 20): Promise<GmailMessageRef[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const data = await gmailGet<{ messages?: GmailMessageRef[] }>(`/users/me/messages?${params}`);
  return data.messages ?? [];
}

export async function getMessage(id: string): Promise<GmailMessage> {
  return gmailGet<GmailMessage>(`/users/me/messages/${id}?format=full`);
}

export async function getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const data = await gmailGet<{ data: string; size: number }>(
    `/users/me/messages/${messageId}/attachments/${attachmentId}`,
  );
  // Gmail returns base64url encoded
  const b64 = data.data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

export function walkParts(p: GmailPart): GmailPart[] {
  const out: GmailPart[] = [p];
  for (const child of p.parts ?? []) out.push(...walkParts(child));
  return out;
}

export function header(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  if (!headers) return '';
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

export interface FetchedAttachment {
  msgId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  internalDate: number;
  subject: string;
  fromAddr: string;
}

/** Pull all CSV attachments from messages matching `query` (e.g. Jasmia's pricelists). */
export async function fetchCsvAttachments(query: string, maxMessages = 10): Promise<FetchedAttachment[]> {
  const refs = await searchMessages(query, maxMessages);
  const out: FetchedAttachment[] = [];
  for (const ref of refs) {
    const msg = await getMessage(ref.id);
    const subject = header(msg.payload.headers, 'Subject');
    const fromAddr = header(msg.payload.headers, 'From');
    const internalDate = parseInt(msg.internalDate ?? '0', 10);

    for (const part of walkParts(msg.payload)) {
      const filename = part.filename ?? '';
      const mt = part.mimeType ?? '';
      if (!filename) continue;
      const isCSV = mt === 'text/csv' || filename.toLowerCase().endsWith('.csv');
      if (!isCSV) continue;
      if (!part.body?.attachmentId) continue;
      const bytes = await getAttachment(msg.id, part.body.attachmentId);
      out.push({ msgId: msg.id, filename, mimeType: mt, bytes, internalDate, subject, fromAddr });
    }
  }
  return out;
}
