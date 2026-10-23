import type { KauflandContact } from './client';

/**
 * Dane kontaktowe GPSR wysyłane do Kauflandu przez `/contacts/*`.
 *
 * Kaufland nie czyta GPSR z atrybutów produktu — ma do tego osobne API kontaktów, z adresem
 * rozbitym na ulicę i numer domu. Bez tych danych Seller Center każe je wpisywać ręcznie przy
 * każdej ofercie (dokładnie to zgłoszone jako „dużo wpisywania — kopiowania z innej oferty”).
 *
 * Źródło wartości: `KAUFLAND_GPSR_*`, a gdy ich brak — `ALLEGRO_PRODUCER_*`, żeby oba
 * marketplace'y miały ten sam podmiot bez dublowania konfiguracji.
 */

const env = (...keys: string[]): string => {
  for (const k of keys) {
    const v = (process.env[k] || '').trim();
    if (v) return v;
  }
  return '';
};

/** „Kępińska 59” → { street: 'Kępińska', house_number: '59' }. Numer = ostatni człon z cyfrą. */
export function splitStreet(full: string): { street: string; house_number: string } {
  const s = full.trim();
  const m = s.match(/^(.*?)[\s,]+(\d+[A-Za-z]?(?:\s*[/\-]\s*\d+[A-Za-z]?)?)$/);
  if (m) return { street: m[1].trim(), house_number: m[2].replace(/\s+/g, '') };
  return { street: s, house_number: '-' };
}

/**
 * Kontakt GPSR producenta. Zwraca `null`, gdy brak kompletu wymaganych danych — wtedy
 * pomijamy wysyłkę zamiast wywoływać błąd walidacji po stronie Kauflandu.
 */
export function manufacturerContact(): KauflandContact | null {
  const name = env('KAUFLAND_GPSR_NAME', 'ALLEGRO_PRODUCER_NAME', 'DEFAULT_PRODUCENT_MARKA');
  const city = env('KAUFLAND_GPSR_CITY', 'ALLEGRO_PRODUCER_CITY');
  const streetRaw = env('KAUFLAND_GPSR_STREET', 'ALLEGRO_PRODUCER_STREET');
  const email = env('KAUFLAND_GPSR_EMAIL', 'ALLEGRO_PRODUCER_EMAIL');
  const url = env('KAUFLAND_GPSR_URL');
  if (!name || !city || !streetRaw || !(email || url)) return null;

  const parsed = splitStreet(streetRaw);
  const country = (env('KAUFLAND_GPSR_COUNTRY', 'ALLEGRO_PRODUCER_COUNTRY') || 'PL').toUpperCase();
  return {
    name: name.slice(0, 255),
    postal_address: {
      street: parsed.street.slice(0, 255),
      house_number: (env('KAUFLAND_GPSR_HOUSE_NUMBER') || parsed.house_number).slice(0, 50),
      city: city.slice(0, 255),
      postal_code: env('KAUFLAND_GPSR_POSTAL_CODE', 'ALLEGRO_PRODUCER_POSTAL_CODE').slice(0, 20) || undefined,
      country_code: country,
    },
    contact_info: {
      email_address: email || undefined,
      website_url: url || undefined,
      phone_number: env('KAUFLAND_GPSR_PHONE') || undefined,
    },
  };
}

/** Nazwa producenta wysyłana w atrybucie `manufacturer` — spójna z kontaktem GPSR. */
export function manufacturerName(): string {
  return env('KAUFLAND_GPSR_NAME', 'ALLEGRO_PRODUCER_NAME', 'DEFAULT_PRODUCENT_MARKA') || 'MEBEL-PARTNER';
}
