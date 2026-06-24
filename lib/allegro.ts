import axios from 'axios';
import { query, queryOne } from './db';
import { AllegroToken } from '@/types';
import { cacheGet, cacheSet } from './cache';

const ALLEGRO_BASE =
  process.env.ALLEGRO_ENV === 'sandbox'
    ? 'https://api.allegro.pl.allegrosandbox.pl'
    : 'https://api.allegro.pl';

const AUTH_BASE =
  process.env.ALLEGRO_ENV === 'sandbox'
    ? 'https://allegro.pl.allegrosandbox.pl'
    : 'https://allegro.pl';

const CLIENT_ID = process.env.ALLEGRO_CLIENT_ID!;
const CLIENT_SECRET = process.env.ALLEGRO_CLIENT_SECRET!;
const REDIRECT_URI = process.env.ALLEGRO_REDIRECT_URI!;

// --- Token management (multi-account) ---

export interface AllegroAccount {
  account_id: string;
  account_name: string;
  expires_at: string;
  created_at: string;
  is_default: number;
  is_active: number;
}

export function getAuthorizationUrl(accountId: string, accountName: string): string {
  const state = Buffer.from(JSON.stringify({ accountId, accountName })).toString('base64url');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    prompt: 'login', // force fresh Allegro login even if session exists
  });
  return `${AUTH_BASE}/auth/oauth/authorize?${params.toString()}`;
}

export function parseOAuthState(state: string): { accountId: string; accountName: string } | null {
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString()) as { accountId: string; accountName: string };
  } catch {
    // Legacy: state might be a plain string or absent
    return { accountId: 'default', accountName: state || 'Domyslne' };
  }
}

export async function exchangeCodeForToken(
  code: string,
  accountId = 'default',
  accountName = 'Domyslne'
): Promise<AllegroToken> {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const response = await axios.post(
    `${AUTH_BASE}/auth/oauth/token`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  const data = response.data;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  await saveToken(data.access_token, data.refresh_token, expiresAt, accountId, accountName);

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt.toISOString(),
  };
}

async function saveToken(
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
  accountId = 'default',
  accountName = 'Domyslne'
): Promise<void> {
  // Upsert per account_id — each account has exactly one row
  await query(
    `INSERT INTO allegro_tokens (account_id, account_name, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       account_name = VALUES(account_name),
       access_token = VALUES(access_token),
       refresh_token = VALUES(refresh_token),
       expires_at = VALUES(expires_at),
       updated_at = NOW()`,
    [accountId, accountName, accessToken, refreshToken, expiresAt]
  );
}

export async function getValidToken(accountId = 'default'): Promise<string | null> {
  let tokenRow = await queryOne<{
    account_id: string; access_token: string; refresh_token: string; expires_at: string;
  }>(
    'SELECT * FROM allegro_tokens WHERE account_id = ? LIMIT 1',
    [accountId]
  );

  // Fallback: if requested account doesn't exist, use is_default=1, then first active account
  if (!tokenRow && accountId === 'default') {
    tokenRow = await queryOne<{
      account_id: string; access_token: string; refresh_token: string; expires_at: string;
    }>(
      'SELECT * FROM allegro_tokens WHERE is_default = 1 AND is_active = 1 LIMIT 1',
      []
    );
    if (!tokenRow) {
      tokenRow = await queryOne<{
        account_id: string; access_token: string; refresh_token: string; expires_at: string;
      }>(
        'SELECT * FROM allegro_tokens WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1',
        []
      );
    }
  }

  if (!tokenRow) return null;

  const expiresAt = new Date(tokenRow.expires_at);
  const bufferMs = 5 * 60 * 1000;

  if (expiresAt.getTime() - Date.now() > bufferMs) {
    return tokenRow.access_token;
  }

  if (tokenRow.refresh_token) {
    try {
      return await refreshAccessToken(tokenRow.refresh_token, accountId);
    } catch {
      return null;
    }
  }

  return null;
}

async function refreshAccessToken(refreshToken: string, accountId = 'default'): Promise<string> {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const response = await axios.post(
    `${AUTH_BASE}/auth/oauth/token`,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  const data = response.data;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  // Preserve existing account_name — don't overwrite with default 'Domyslne'
  const existing = await queryOne<{ account_name: string }>(
    'SELECT account_name FROM allegro_tokens WHERE account_id = ? LIMIT 1',
    [accountId]
  );
  const accountName = existing?.account_name ?? 'Domyslne';

  await saveToken(data.access_token, data.refresh_token, expiresAt, accountId, accountName);

  return data.access_token;
}

export async function isAuthenticated(accountId = 'default'): Promise<boolean> {
  const token = await getValidToken(accountId);
  return token !== null;
}

/** Verify a token is actually accepted by Allegro (not just unexpired in DB). */
export async function verifyToken(accountId = 'default'): Promise<boolean> {
  const token = await getValidToken(accountId);
  if (!token) return false;
  try {
    await axios.get(`${ALLEGRO_BASE}/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function listAccounts(activeOnly = false): Promise<AllegroAccount[]> {
  // Only Allegro accounts — Mirakl shops live in the same table (marketplace='mirakl').
  const where = activeOnly ? "WHERE marketplace = 'allegro' AND is_active = 1" : "WHERE marketplace = 'allegro'";
  return query<AllegroAccount>(
    `SELECT account_id, account_name, expires_at, created_at, is_default, is_active FROM allegro_tokens ${where} ORDER BY is_default DESC, created_at ASC`
  );
}

export async function deleteAccount(accountId: string): Promise<void> {
  await query('DELETE FROM allegro_tokens WHERE account_id = ?', [accountId]);
}

export interface AllegroAccountInfo {
  login: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: { name?: string; taxId?: string };
  activeOffers: number;
  totalOffers: number;
  endedOffers: number;
}

export async function getAccountInfo(accountId = 'default'): Promise<AllegroAccountInfo> {
  const token = await getValidToken(accountId);
  if (!token) throw new Error('Not authenticated');

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.allegro.public.v1+json',
  };

  const [meRes, activeRes, totalRes, endedRes] = await Promise.all([
    axios.get(`${ALLEGRO_BASE}/me`, { headers }),
    axios.get(`${ALLEGRO_BASE}/sale/offers`, { headers, params: { 'publication.status': 'ACTIVE', limit: 1 } }),
    axios.get(`${ALLEGRO_BASE}/sale/offers`, { headers, params: { limit: 1 } }),
    axios.get(`${ALLEGRO_BASE}/sale/offers`, { headers, params: { 'publication.status': 'ENDED', limit: 1 } }),
  ]);

  const me = meRes.data as {
    login?: string; email?: string; firstName?: string; lastName?: string;
    company?: { name?: string; taxId?: string };
  };

  return {
    login: me.login || '',
    email: me.email || '',
    firstName: me.firstName,
    lastName: me.lastName,
    company: me.company,
    activeOffers: (activeRes.data as { count?: number }).count ?? 0,
    totalOffers: (totalRes.data as { count?: number }).count ?? 0,
    endedOffers: (endedRes.data as { count?: number }).count ?? 0,
  };
}

// --- Allegro API calls ---

function allegroApi(token: string) {
  return axios.create({
    baseURL: `${ALLEGRO_BASE}/sale`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.allegro.public.v1+json',
      'Content-Type': 'application/vnd.allegro.public.v1+json',
    },
  });
}

export async function getCategories(parentId?: string): Promise<unknown[]> {
  const key = `allegro:categories:${parentId ?? 'root'}`;
  const cached = cacheGet<unknown[]>(key);
  if (cached) return cached;

  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated');

  const api = allegroApi(token);
  const params: Record<string, string> = {};
  if (parentId) params['parent.id'] = parentId;

  const response = await api.get('/categories', { params });
  const result = response.data.categories || [];
  cacheSet(key, result);
  return result;
}

export async function getCategoryById(categoryId: string): Promise<unknown> {
  const key = `allegro:category:${categoryId}`;
  const cached = cacheGet<unknown>(key);
  if (cached) return cached;

  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated');

  const api = allegroApi(token);
  const response = await api.get(`/categories/${categoryId}`);
  cacheSet(key, response.data);
  return response.data;
}

export interface AllegroParamDictValue {
  id: string;
  value: string;
  requiresProposal?: boolean;
}

export interface AllegroParamDef {
  id: string;
  name: string;
  type: string; // TEXT | DICTIONARY | FLOAT | INTEGER
  required: boolean;
  requiredForProduct?: boolean;
  options?: { describesProduct?: boolean };
  restrictions?: {
    multipleChoices?: boolean;
    min?: number;
    max?: number;
    range?: boolean;
    precision?: number;
    maxLength?: number;
  };
  dictionary?: AllegroParamDictValue[];
}

// Offer-level parameters (top-level `parameters` in product-offer payload)
export async function getCategoryParameters(categoryId: string): Promise<AllegroParamDef[]> {
  const key = `allegro:params:${categoryId}`;
  const cached = cacheGet<AllegroParamDef[]>(key);
  if (cached) return cached;

  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated');

  const api = allegroApi(token);
  const response = await api.get(`/categories/${categoryId}/parameters`);
  const result = (response.data.parameters || []) as AllegroParamDef[];
  cacheSet(key, result);
  return result;
}

// Product-level parameters (for productSet[].product.parameters)
export async function getProductParameters(categoryId: string): Promise<AllegroParamDef[]> {
  const key = `allegro:product-params:${categoryId}`;
  const cached = cacheGet<AllegroParamDef[]>(key);
  if (cached) return cached;

  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated');

  const api = allegroApi(token);
  try {
    const response = await api.get(`/categories/${categoryId}/product-parameters`);
    const result = (response.data.parameters || []) as AllegroParamDef[];
    cacheSet(key, result);
    return result;
  } catch {
    return [];
  }
}

export async function searchAllegroCategories(phrase: string): Promise<unknown[]> {
  const key = `allegro:search:${phrase}`;
  const cached = cacheGet<unknown[]>(key);
  if (cached) return cached;

  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated');

  const api = allegroApi(token);
  const response = await api.get('/matching-categories', { params: { phrase } });
  const result = response.data.matchingCategories || [];
  cacheSet(key, result);
  return result;
}

async function getFirstAfterSalesService(path: string, accountId = 'default'): Promise<string | null> {
  // Env var overrides are only reliable for sandbox — on production always fetch from API
  if (process.env.ALLEGRO_ENV === 'sandbox') {
    if (path === 'return-policies' && process.env.ALLEGRO_RETURN_POLICY_ID) {
      return process.env.ALLEGRO_RETURN_POLICY_ID;
    }
    if (path === 'implied-warranties' && process.env.ALLEGRO_IMPLIED_WARRANTY_ID) {
      return process.env.ALLEGRO_IMPLIED_WARRANTY_ID;
    }
  }

  const key = `allegro:after-sales:${path}:${accountId}`;
  const cached = cacheGet<string>(key);
  if (cached) return cached;

  const token = await getValidToken(accountId);
  if (!token) return null;
  try {
    const response = await axios.get(`${ALLEGRO_BASE}/after-sales-service-conditions/${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
      },
      params: { limit: 1 },
    });
    const items: Array<{ id: string }> = response.data[Object.keys(response.data)[0]] || [];
    const id = items[0]?.id ?? null;
    if (id) cacheSet(key, id);
    return id;
  } catch {
    return null;
  }
}

// GPSR — responsiblePerson must always accompany responsibleProducer.
// Required when producer is from a non-EU country (Allegro enforces this).
// References a pre-registered entity from POST /sale/responsible-persons.
async function getResponsiblePersonId(accountId = 'default'): Promise<string> {
  if (process.env.ALLEGRO_RESPONSIBLE_PERSON_ID) return process.env.ALLEGRO_RESPONSIBLE_PERSON_ID;

  const key = `allegro:responsible-person:${accountId}`;
  const cached = cacheGet<string>(key);
  if (cached) return cached;

  const token = await getValidToken(accountId);
  if (!token) throw new Error(`Not authenticated (account: ${accountId})`);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.allegro.public.v1+json',
    'Content-Type': 'application/vnd.allegro.public.v1+json',
  };

  const listRes = await axios.get(`${ALLEGRO_BASE}/sale/responsible-persons`, {
    headers,
    params: { limit: 1 },
  });
  const existing = listRes.data.responsiblePersons as Array<{ id: string }> | undefined;
  if (existing && existing.length > 0) {
    cacheSet(key, existing[0].id);
    return existing[0].id;
  }

  const createRes = await axios.post(
    `${ALLEGRO_BASE}/sale/responsible-persons`,
    {
      name: (process.env.ALLEGRO_PRODUCER_NAME || 'Serwis Ogumienia Opony Master.pl').slice(0, 50),
      address: {
        street: process.env.ALLEGRO_PRODUCER_STREET || 'Grabik 17 C',
        city: process.env.ALLEGRO_PRODUCER_CITY || 'Żary',
        zipCode: process.env.ALLEGRO_PRODUCER_POSTAL_CODE || '68-200',
        countryCode: process.env.ALLEGRO_PRODUCER_COUNTRY || 'PL',
      },
      contact: {
        email: process.env.ALLEGRO_PRODUCER_EMAIL || 'sklep@oponymaster.pl',
      },
    },
    { headers }
  );
  const id = createRes.data.id as string;
  cacheSet(key, id);
  return id;
}

// GPSR — responsibleProducer in productSet must be { type: "ID", id: uuid }
// referencing a pre-registered producer from POST /sale/responsible-producers.
// This fetches the first existing one for the account, or creates it on first use.
async function getResponsibleProducerId(accountId = 'default'): Promise<string> {
  const token = await getValidToken(accountId);
  if (!token) throw new Error(`Not authenticated (account: ${accountId})`);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.allegro.public.v1+json',
    'Content-Type': 'application/vnd.allegro.public.v1+json',
  };

  // Return cached env var ID if set (avoids extra API call on every publish)
  if (process.env.ALLEGRO_PRODUCER_ID) return process.env.ALLEGRO_PRODUCER_ID;

  // Fetch existing producers for this account
  const listRes = await axios.get(`${ALLEGRO_BASE}/sale/responsible-producers`, {
    headers,
    params: { limit: 1 },
  });
  const existing = listRes.data.responsibleProducers as Array<{ id: string }> | undefined;
  if (existing && existing.length > 0) return existing[0].id;

  // None registered yet — create one from env vars
  const createRes = await axios.post(
    `${ALLEGRO_BASE}/sale/responsible-producers`,
    {
      name: (process.env.ALLEGRO_PRODUCER_NAME || 'Serwis Ogumienia Opony Master.pl').slice(0, 50),
      producerData: {
        tradeName: process.env.ALLEGRO_PRODUCER_NAME || 'Serwis Ogumienia Opony Master.pl',
        address: {
          street: process.env.ALLEGRO_PRODUCER_STREET || 'Grabik 17 C',
          city: process.env.ALLEGRO_PRODUCER_CITY || 'Żary',
          postalCode: process.env.ALLEGRO_PRODUCER_POSTAL_CODE || '68-200',
          countryCode: process.env.ALLEGRO_PRODUCER_COUNTRY || 'PL',
        },
        contact: {
          email: process.env.ALLEGRO_PRODUCER_EMAIL || 'sklep@oponymaster.pl',
        },
      },
    },
    { headers }
  );
  return createRes.data.id as string;
}

// Tyre category IDs (Allegro production)
export const TYRE_CATEGORIES = {
  opony: '119435',       // Opony letnie
  felgi: '165',          // Felgi
  kola: '29648',         // Koła kompletne
};

export async function createOffer(formData: Record<string, unknown>, accountId = 'default'): Promise<{ id: string }> {
  const token = await getValidToken(accountId);
  if (!token) throw new Error(`Not authenticated (account: ${accountId})`);

  const GPSR_CODES = new Set(['RESPONSIBLE_PRODUCER_NOT_SPECIFIED', 'SAFETY_INFO_NOT_DEFINED']);

  const doPost = (payload: Record<string, unknown>) =>
    axios.post(`${ALLEGRO_BASE}/sale/product-offers`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
        'Content-Type': 'application/vnd.allegro.public.v1+json',
      },
    });

  interface AllegroError {
    code: string;
    metadata?: {
      parameterId?: string;
      expectedParameterValueId?: string;
    };
  }

  const applyMismatches = (
    payload: Record<string, unknown>,
    errors: AllegroError[]
  ): Record<string, unknown> => {
    const mismatches = errors.filter(
      (e) => e.code === 'PARAMETER_MISMATCH' && e.metadata?.parameterId && e.metadata?.expectedParameterValueId
    );
    if (mismatches.length === 0) return payload;

    // Deep-clone to avoid mutating original
    const fixed = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;

    // Patch params inside productSet[0].product.parameters
    type ParamEntry = { id: string; valuesIds?: string[]; values?: string[] };
    const productParams: ParamEntry[] =
      ((fixed.productSet as { product?: { parameters?: ParamEntry[] } }[])?.[0]?.product?.parameters) ?? [];

    for (const mismatch of mismatches) {
      const { parameterId, expectedParameterValueId } = mismatch.metadata!;
      const existing = productParams.find((p) => p.id === parameterId);
      if (existing) {
        existing.valuesIds = [expectedParameterValueId!];
      } else {
        productParams.push({ id: parameterId!, valuesIds: [expectedParameterValueId!] });
      }
    }

    if ((fixed.productSet as unknown[])?.[0]) {
      const ps = fixed.productSet as Record<string, unknown>[];
      const product = (ps[0].product ?? {}) as Record<string, unknown>;
      product.parameters = productParams;
      ps[0].product = product;
    }

    return fixed;
  };

  try {
    const response = await doPost(formData);
    return { id: response.data.id };
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const data = error.response.data as { id?: string; errors?: AllegroError[] };
      const errors: AllegroError[] = data.errors || [];

      // On sandbox, GPSR errors are false positives — offer is still created
      if (status === 422 && process.env.ALLEGRO_ENV === 'sandbox') {
        const nonGpsr = errors.filter((e) => !GPSR_CODES.has(e.code));
        if (nonGpsr.length === 0 && data.id) return { id: data.id };
      }

      // Auto-fix PARAMETER_MISMATCH (catalog product already exists with different values)
      const hasMismatches = errors.some((e) => e.code === 'PARAMETER_MISMATCH');
      if (status === 422 && hasMismatches) {
        const fixed = applyMismatches(formData, errors);
        try {
          const retry = await doPost(fixed);
          return { id: retry.data.id };
        } catch (retryErr: unknown) {
          if (axios.isAxiosError(retryErr) && retryErr.response) {
            const rd = retryErr.response.data;
            console.log("AA error1");
            var err = rd.errors.map((e: { userMessage?: string }) => {
              return e.userMessage;
            });
            err = err.join("\n\r");
            throw new Error(`Allegro API ${retryErr.response.status}: ${err}`);
          }
          throw retryErr;
        }
      }

      console.error('Allegro API error:', status, JSON.stringify(data));
      throw new Error(`Allegro API ${status}: ${JSON.stringify(data)}`);
    }
    throw error;
  }
}

export async function updateOffer(allegroOfferId: string, payload: Record<string, unknown>, accountId = 'default'): Promise<void> {
  const token = await getValidToken(accountId);
  if (!token) throw new Error(`Not authenticated (account: ${accountId})`);

  try {
    await axios.patch(`${ALLEGRO_BASE}/sale/product-offers/${allegroOfferId}`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
        'Content-Type': 'application/vnd.allegro.public.v1+json',
      },
    });
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response) {
      throw new Error(`Allegro API ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

export async function publishOffer(offerId: string): Promise<void> {
  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated');

  const commandId = crypto.randomUUID();

  await axios.put(
    `${ALLEGRO_BASE}/sale/offer-publication-commands/${commandId}`,
    {
      offerCriteria: [{ offers: [{ id: offerId }], type: 'CONTAINS_OFFERS' }],
      publication: { action: 'ACTIVATE' },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
        'Content-Type': 'application/vnd.allegro.public.v1+json',
      },
    }
  );
}

export async function getOffer(offerId: string): Promise<Record<string, unknown>> {
  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated');

  const response = await axios.get(
    `${ALLEGRO_BASE}/sale/product-offers/${offerId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
      },
    }
  );

  return response.data;
}

/** Fetch live offer data from Allegro (product-offers endpoint) for a specific account. */
export async function getLiveOffer(
  allegroOfferId: string,
  accountId = 'default'
): Promise<Record<string, unknown>> {
  const token = await getValidToken(accountId);
  if (!token) throw new Error(`Not authenticated: account ${accountId}`);

  const response = await axios.get(
    `${ALLEGRO_BASE}/sale/product-offers/${allegroOfferId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
      },
    }
  );
  return response.data;
}

/**
 * Best-effort EAN/GTIN extraction from an Allegro product-offer detail (shape varies):
 * scans parameters (incl. "Kod producenta", which this seller uses as EAN), product gtins/ean,
 * then offer-level external.id, then any parameter whose value is a 13-digit code.
 */
export function extractEanFromOffer(detail: Record<string, unknown>): string | null {
  const isEan = (v: unknown): v is string => typeof v === 'string' && /^\d{8,14}$/.test(v.trim());
  // "Kod producenta" = manufacturer code, used here as the EAN.
  const nameLooksEan = (n: string) => /ean|gtin|kod\s*producenta/i.test(n);
  type Param = { id?: string; name?: string; values?: string[] };

  const paramGroups: Param[][] = [];
  const productSet = (detail.productSet as { product?: Record<string, unknown> }[] | undefined) || [];
  for (const entry of productSet) {
    const product = entry?.product || {};
    const gtins = product.gtins as string[] | undefined;
    if (gtins?.length && isEan(gtins[0])) return gtins[0];
    if (isEan(product.ean)) return product.ean as string;
    paramGroups.push((product.parameters as Param[] | undefined) || []);
  }
  paramGroups.push((detail.parameters as Param[] | undefined) || []);

  // 1) Parameter explicitly named like an EAN / Kod producenta.
  for (const params of paramGroups) {
    for (const p of params) {
      if (nameLooksEan(p.name || '') && p.values?.length && isEan(p.values[0])) return p.values[0].trim();
    }
  }

  const ext = (detail.external as { id?: string } | undefined)?.id;
  if (isEan(ext)) return ext as string;

  // 2) Fallback: any parameter whose value is a 13-digit code (EAN-13).
  for (const params of paramGroups) {
    for (const p of params) {
      const v = p.values?.[0]?.trim();
      if (v && /^\d{13}$/.test(v)) return v;
    }
  }
  return null;
}

/** List a seller account's live offers (real Allegro data), paginated. */
export async function listAccountOffers(
  accountId = 'default',
  offset = 0,
  limit = 50
): Promise<{ offers: Record<string, unknown>[]; total: number }> {
  const token = await getValidToken(accountId);
  if (!token) throw new Error(`Not authenticated: account ${accountId}`);
  const response = await axios.get(`${ALLEGRO_BASE}/sale/offers`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json' },
    params: { offset, limit },
  });
  return {
    offers: (response.data?.offers ?? []) as Record<string, unknown>[],
    total: Number(response.data?.totalCount ?? response.data?.count ?? 0),
  };
}

/** End (withdraw) a published offer via the publication command API (action END → ENDED). */
export async function endOffer(allegroOfferId: string, accountId = 'default'): Promise<void> {
  const token = await getValidToken(accountId);
  if (!token) throw new Error(`Not authenticated: account ${accountId}`);
  const commandId = crypto.randomUUID();
  await axios.put(
    `${ALLEGRO_BASE}/sale/offer-publication-commands/${commandId}`,
    {
      offerCriteria: [{ offers: [{ id: allegroOfferId }], type: 'CONTAINS_OFFERS' }],
      publication: { action: 'END' },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
        'Content-Type': 'application/vnd.allegro.public.v1+json',
      },
    }
  );
}

/** Partial update of price and stock for a published offer (no full payload needed). */
export async function updateOfferPriceStock(
  allegroOfferId: string,
  price: number,
  quantity: number,
  accountId = 'default'
): Promise<void> {
  const token = await getValidToken(accountId);
  if (!token) throw new Error(`Not authenticated: account ${accountId}`);
  await axios.patch(
    `${ALLEGRO_BASE}/sale/product-offers/${allegroOfferId}`,
    { sellingMode: { price: { amount: String(price), currency: 'PLN' } }, stock: { available: quantity } },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
        'Content-Type': 'application/vnd.allegro.public.v1+json',
      },
    }
  );
}

/** Fetch quality scores for a batch of offer IDs for a specific account. */
export async function getQualityScores(
  allegroOfferIds: string[],
  accountId = 'default'
): Promise<Record<string, unknown>[]> {
  if (allegroOfferIds.length === 0) return [];
  const token = await getValidToken(accountId);
  if (!token) throw new Error(`Not authenticated: account ${accountId}`);

  const params = new URLSearchParams();
  allegroOfferIds.forEach((id) => params.append('offer.id', id));

  try {
    const response = await axios.get(
      `${ALLEGRO_BASE}/sale/quality-scores?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.allegro.public.v1+json',
        },
      }
    );
    return response.data.qualityScores || response.data || [];
  } catch {
    return [];
  }
}

// Strip markdown code fences and convert disallowed HTML tags to Allegro-allowed equivalents.
// Allowed: h1, h2, p, ul, ol, li, b
function sanitizeAllegroDescription(html: string): string {
  const ALLOWED = new Set(['h1', 'h2', 'p', 'ul', 'ol', 'li', 'b']);
  const SELF_CLOSING = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

  let clean = html
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Step 1: Conversions before filtering
  clean = clean.replace(/<(\/?)h[3-6][^>]*>/gi, '<$1h2>');
  clean = clean.replace(/<(\/?)strong[^>]*>/gi, '<$1b>');

  // Step 2: Whitelist — strip any tag not in ALLOWED set
  // Self-closing tags (img, br, etc.) are removed entirely; others lose only the tag, text stays
  clean = clean.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g, (match, tag) => {
    const t = tag.toLowerCase();
    if (ALLOWED.has(t)) return match;
    if (SELF_CLOSING.has(t)) return '';
    return '';
  });

  // Step 3: Close unclosed tags using a stack
  const stack: string[] = [];
  clean.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (match, tag) => {
    const t = tag.toLowerCase();
    if (!ALLOWED.has(t)) return match;
    if (match.startsWith('</')) {
      const idx = stack.lastIndexOf(t);
      if (idx >= 0) stack.splice(idx, 1);
    } else {
      stack.push(t);
    }
    return match;
  });
  clean = clean + stack.reverse().map((t) => `</${t}>`).join('');

  // Step 4: Escape bare & not already part of an HTML entity
  clean = clean.replace(/&(?!(?:amp|nbsp|quot|apos|lt|gt|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

  return clean;
}

export async function getAllShippingRates(accountId = 'default'): Promise<{ id: string; name: string }[]> {
  const key = `allegro:shipping-rates-all:${accountId}`;
  const cached = cacheGet<{ id: string; name: string }[]>(key);
  if (cached) return cached;

  const token = await getValidToken(accountId);
  if (!token) return [];
  try {
    const res = await axios.get(`${ALLEGRO_BASE}/sale/shipping-rates`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
      },
    });
    const rates = (res.data.shippingRates as { id: string; name: string }[]) || [];
    if (rates.length > 0) cacheSet(key, rates);
    return rates;
  } catch {
    return [];
  }
}

export async function getFirstShippingRate(accountId = 'default'): Promise<string | null> {
  if (process.env.ALLEGRO_SHIPPING_RATE_ID) return process.env.ALLEGRO_SHIPPING_RATE_ID;
  const rates = await getAllShippingRates(accountId);
  return rates[0]?.id ?? null;
}

/** Search Allegro product catalog by phrase. Returns catalog product ID or null. */
async function searchCatalogByPhrase(
  phrase: string,
  categoryId: string,
  token: string
): Promise<string | null> {
  try {
    const response = await axios.get(`${ALLEGRO_BASE}/sale/products`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json' },
      params: { phrase, 'category.id': categoryId, language: 'pl-PL' },
    });
    const products = response.data.products as Array<{ id: string }> | undefined;
    return products?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Search Allegro product catalog by EAN first, then by product phrase as fallback.
 * Using a catalog product ID avoids sending EAN to Allegro (which validates against GS1).
 */
async function findCatalogProduct(
  ean: string | null,
  categoryId: string,
  phraseForFallback: string | null,
  accountId = 'default'
): Promise<string | null> {
  const token = await getValidToken(accountId);
  if (!token) return null;

  if (ean) {
    const byEan = await searchCatalogByPhrase(ean, categoryId, token);
    if (byEan) return byEan;
  }

  if (phraseForFallback) {
    // Strip quantity prefix like "4 szt. " and limit to brand+model+size for best match
    const cleanPhrase = phraseForFallback.replace(/^\d+\s*szt\.\s*/i, '').slice(0, 60);
    return await searchCatalogByPhrase(cleanPhrase, categoryId, token);
  }

  return null;
}

// Build Allegro offer payload for POST /sale/product-offers.
// All category-specific parameters come from formData.params (paramId → value/values).
export async function buildAllegroPayload(formData: Record<string, unknown>, accountId = 'default'): Promise<Record<string, unknown>> {
  const data = formData as {
    title: string;
    sku: string;
    categoryId: string;
    description: string;
    price: number;
    quantity: number;
    quantity_in_set?: number;
    condition: string;
    invoice?: 'VAT' | 'VAT_MARGIN';
    images: string[];
    shippingTime: string;
    shippingRateIds?: Record<string, string>;
    params: Record<string, string | string[]>;
  };

  if (!data.categoryId) throw new Error('Nie wybrano kategorii Allegro');

  type Param = { id: string; valuesIds: string[]; values: string[] };

  // Fetch both param sets in parallel
  const [productParamDefs, offerParamDefs] = await Promise.all([
    getProductParameters(data.categoryId),
    getCategoryParameters(data.categoryId),
  ]);

  const productParamIds = new Set(productParamDefs.map((p) => p.id));
  const offerParamIds = new Set(offerParamDefs.map((p) => p.id));
  const allParamDefs = new Map([...productParamDefs, ...offerParamDefs].map((p) => [p.id, p]));

  const productParams: Param[] = [];
  const offerParams: Param[] = [];

  // EAN/GTIN placeholder inserted by AI when real code is unknown — skip it
  const EAN_PLACEHOLDER = '0000000000000';
  // EAN param IDs for this category — used to extract value for catalog lookup
  const EAN_PARAM_IDS = new Set(['224017', '225693']);

  // Extract EAN value before the loop so we can try catalog product lookup
  let eanValue: string | null = null;
  for (const eid of Array.from(EAN_PARAM_IDS)) {
    const v = data.params?.[eid];
    const vStr = Array.isArray(v) ? v[0] : v;
    if (vStr && vStr !== EAN_PLACEHOLDER) { eanValue = vStr; break; }
  }

  // Find matching Allegro catalog product — try EAN first, then product title as fallback.
  // Using catalog product ID avoids sending EAN (GS1 validation), responsibleProducer conflict, etc.
  const catalogProductId = await findCatalogProduct(eanValue, data.categoryId, data.title ?? null, accountId);

  for (const [paramId, rawValue] of Object.entries(data.params || {})) {
    // Skip proposal helper keys — they are consumed below, not sent as separate params
    if (paramId.endsWith('__proposal')) continue;

    // Skip EAN params only when using a catalog product ID — they're already embedded
    // in the catalog product. When not using catalog product, EAN must be sent so Allegro
    // can match or create a catalog product (it's a required product parameter).
    if (EAN_PARAM_IDS.has(paramId) && catalogProductId) continue;

    if (!rawValue || (Array.isArray(rawValue) && rawValue.length === 0)) continue;

    const paramDef = allParamDefs.get(paramId);
    const isDict = paramDef?.type === 'dictionary';
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];

    // Skip placeholder EAN values
    if (values.length === 1 && values[0] === EAN_PLACEHOLDER) continue;

    // Skip numeric params with value "0" — likely unfilled (e.g. EPREL code)
    if ((paramDef?.type === 'integer' || paramDef?.type === 'float') && values[0] === '0') continue;

    // Skip string params that are all-zero placeholders (e.g. EPREL "000000", "0000000")
    if (paramDef?.type === 'string' && /^0+$/.test(values[0] ?? '')) continue;

    // Proposal text only applies to product-level params (productSet[0].product.parameters).
    // Offer-level params (parameters) don't support mixing valuesIds + custom values[] — Allegro rejects it.
    let proposalValues: string[] = [];
    if (isDict && productParamIds.has(paramId)) {
      const proposal = data.params[`${paramId}__proposal`];
      const proposalText = Array.isArray(proposal) ? proposal[0] : proposal;
      if (proposalText) {
        const selectedEntry = paramDef?.dictionary?.find((d) => values.includes(d.id));
        const entryNeedsProposal = !!selectedEntry?.requiresProposal
          || /^(inny|inna|inne|other|inaczej)$/i.test((selectedEntry?.value ?? '').trim());
        if (entryNeedsProposal) proposalValues = [String(proposalText)];
      }
    }

    const param: Param = isDict
      ? { id: paramId, valuesIds: values, values: proposalValues }
      : { id: paramId, valuesIds: [], values: values };

    if (productParamIds.has(paramId)) {
      productParams.push(param);
    } else if (offerParamIds.has(paramId)) {
      offerParams.push(param);
    }
    // Unknown paramId — skip
  }

  const imageUrls: string[] = data.images || [];

  const [returnPolicyId, impliedWarrantyId, fallbackShippingRateId] = await Promise.all([
    getFirstAfterSalesService('return-policies', accountId),
    getFirstAfterSalesService('implied-warranties', accountId),
    getFirstShippingRate(accountId),
  ]);
  const shippingRateId = data.shippingRateIds?.[accountId] ?? fallbackShippingRateId;

  const afterSalesServices: Record<string, { id: string }> = {};
  if (returnPolicyId) afterSalesServices.returnPolicy = { id: returnPolicyId };
  if (impliedWarrantyId) afterSalesServices.impliedWarranty = { id: impliedWarrantyId };

  const [responsibleProducerId, responsiblePersonId] = await Promise.all([
    getResponsibleProducerId(accountId),
    getResponsiblePersonId(accountId),
  ]);

  // Use catalog product ID when found — Allegro then respects our productSet fields
  // (responsibleProducer, safetyInformation) without the catalog-override conflict.
  const productObject: Record<string, unknown> = catalogProductId
    ? { id: catalogProductId }
    : { name: data.title, category: { id: data.categoryId }, parameters: productParams, images: imageUrls };

  const productSetEntry: Record<string, unknown> = {
    product: productObject,
    responsibleProducer: { type: 'ID', id: responsibleProducerId },
    responsiblePerson: { id: responsiblePersonId },
    safetyInformation: {
      type: 'TEXT',
      description: process.env.ALLEGRO_SAFETY_DESCRIPTION ||
        'Opona samochodowa. Montaż wyłącznie przez wykwalifikowany personel. Przechowywać z dala od dzieci. Sprawdzić datę produkcji przed montażem.',
    },
  };


  return {
    productSet: [productSetEntry],
    name: data.title,
    description: {
      sections: [{
        items: [{ type: 'TEXT', content: sanitizeAllegroDescription(data.description) }],
      }],
    },
    parameters: offerParams,
    images: imageUrls,
    external: {
      id: data.sku
    },
    sellingMode: {
      format: 'BUY_NOW',
      price: { amount: Number(data.price).toFixed(2), currency: 'PLN' },
    },
    stock: {
      available: data.quantity,
      unit: 'UNIT',
    },
    delivery: {
      handlingTime: data.shippingTime || 'PT24H',
      ...(shippingRateId ? { shippingRates: { id: shippingRateId } } : {}),
    },
    payments: {
      invoice: data.invoice ?? (data.condition === 'USED' ? 'VAT_MARGIN' : 'VAT'),
    },
    ...(Object.keys(afterSalesServices).length > 0 ? { afterSalesServices } : {}),
  };
}
