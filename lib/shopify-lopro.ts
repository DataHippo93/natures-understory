// Server-only Shopify Admin GraphQL client for the LoPro store (wholesale).
//
// Auth: OAuth client credentials grant (Dev Dashboard app). Tokens live 24h;
// we cache in-module and refresh 60s early; one auto-retry on 401.
// Env (Vercel): LOPRO_SHOPIFY_SHOP, LOPRO_SHOPIFY_API_VERSION,
//   LOPRO_SHOPIFY_CLIENT_ID, LOPRO_SHOPIFY_CLIENT_SECRET (all in BWS,
//   project natures-storehouse). NEVER import from client components.

let cachedToken: { token: string; expiresAt: number } | null = null;

function cfg() {
  const shop = process.env.LOPRO_SHOPIFY_SHOP;
  const clientId = process.env.LOPRO_SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.LOPRO_SHOPIFY_CLIENT_SECRET;
  const apiVersion = process.env.LOPRO_SHOPIFY_API_VERSION ?? '2026-04';
  if (!shop || !clientId || !clientSecret) {
    throw new Error('LoPro Shopify env vars are not configured');
  }
  return { shop, clientId, clientSecret, apiVersion };
}

async function fetchToken(): Promise<string> {
  const { shop, clientId, clientSecret } = cfg();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Shopify token exchange failed: ${res.status}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  return fetchToken();
}

interface GraphQLResult<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/** Execute a GraphQL query/mutation against the LoPro Admin API. */
export async function shopifyGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  retried = false
): Promise<T> {
  const { shop, apiVersion } = cfg();
  const token = await getToken();
  const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });

  if (res.status === 401 && !retried) {
    cachedToken = null;
    return shopifyGraphQL<T>(query, variables, true);
  }
  if (!res.ok) {
    throw new Error(`Shopify GraphQL HTTP ${res.status}`);
  }

  const body = (await res.json()) as GraphQLResult<T>;
  if (body.errors?.length) {
    throw new Error(`Shopify GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  return body.data as T;
}

/** Throw if a mutation returned userErrors. */
export function assertNoUserErrors(
  userErrors: Array<{ field?: string[] | null; message: string }> | undefined,
  context: string
): void {
  if (userErrors && userErrors.length > 0) {
    throw new Error(
      `${context}: ${userErrors.map((e) => `${(e.field ?? []).join('.')} ${e.message}`.trim()).join('; ')}`
    );
  }
}
