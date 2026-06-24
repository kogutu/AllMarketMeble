/**
 * Mirakl operator registry. Adding a new Mirakl marketplace = adding one entry here plus its
 * env vars (base URL + API key). No new code paths are required.
 *
 * Per-shop API key and base URL can also be overridden from the DB (allegro_tokens.api_key /
 * base_url) — see resolveMiraklCredentials in client.ts.
 */
export interface MiraklOperator {
  id: string;          // stable operator id, also used as account_id default
  name: string;        // display name
  baseUrlEnv: string;  // env var with the operator API base URL
  apiKeyEnv: string;   // env var with the default shop API key
  defaultBaseUrl?: string;
}

export const MIRAKL_OPERATORS: MiraklOperator[] = [
  {
    id: 'empik',
    name: 'Empik',
    baseUrlEnv: 'MIRAKL_EMPIK_BASE_URL',
    apiKeyEnv: 'EMPIK_APIKEY', // existing key in .env.local
    defaultBaseUrl: 'https://empik-prod.mirakl.net',
  },
  {
    id: 'brw',
    name: 'Black Red White',
    baseUrlEnv: 'MIRAKL_BRW_BASE_URL',
    apiKeyEnv: 'BRW_APIKEY',
  },
];

export function getOperator(id: string): MiraklOperator | undefined {
  return MIRAKL_OPERATORS.find((o) => o.id === id);
}

export function listOperators(): MiraklOperator[] {
  return MIRAKL_OPERATORS;
}
