import OpenAI from 'openai';
import { TyreProduct, AllegroFormData, ValidationResult } from '@/types';
import { AllegroParamDef, AllegroParamDictValue } from '@/lib/allegro';

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// --- Generate Allegro description ---

export async function generateDescription(
  product: TyreProduct,
  formData: Partial<AllegroFormData>
): Promise<string> {
  const client = getClient();

  const attrs = product.extra_json?.attrs || {};
  const dotList = product.extra_json?.dot_list || [];
  const treadDepth = product.extra_json?.tread_depth || '';

  const prompt = `
Jesteś ekspertem sprzedaży opon na Allegro. Napisz profesjonalny, przekonujący opis aukcji w języku polskim.

Dane produktu:
- Marka: ${product.brand}
- Model: ${product.model}
- Rozmiar: ${product.width}/${product.profile} R${product.diameter}
- Sezon: ${product.season}
- Stan: ${product.condition === 'used' ? 'Używany' : 'Nowy'}
- Ilość: ${product.extra_json?.offer_qty || product.qty} szt.
- Indeks nośności: ${product.load_index}
- Indeks prędkości: ${product.speed_index}
- XL/Wzmocnione: ${product.xl ? 'Tak' : 'Nie'}
- Run Flat: ${product.runflat ? 'Tak' : 'Nie'}
- Klasa mokrego przyczepności: ${product.wet_grip || 'N/D'}
- Opór toczenia: ${product.rolling_resistance || 'N/D'}
- Głębokość bieżnika: ${treadDepth}
- DOT (rok prod.): ${dotList.join(', ') || product.production_year || 'N/D'}
- Typ pojazdu: ${product.vehicle_class}
${attrs['WADY OPON'] ? `- Uwagi/wady: ${attrs['WADY OPON']}` : ''}
${attrs['Zalety opon'] ? `- Zalety: ${attrs['Zalety opon']}` : ''}
${product.extra_json?.notes ? `- Notatki: ${product.extra_json.notes}` : ''}

Wymagania opisu:
1. Zacznij od krótkiego wstępu o produkcie
2. Wylistuj kluczowe cechy i zalety
3. Podaj szczegółowe parametry techniczne
4. Wspomnij o stanie (${product.condition === 'used' ? 'używane' : 'nowe'}) i głębokości bieżnika
5. Dodaj informacje o wysyłce
6. Zakończ zachętą do zakupu
7. Użyj TYLKO dozwolonych znaczników HTML: <h1> (tytuł), <h2> (podtytuł), <p> (akapit), <ul>/<ol>/<li> (listy), <b> (pogrubienie). NIE używaj: h3, h4, h5, h6, strong, em, div, span ani żadnych innych tagów.
8. NIE owijaj opisu w bloki markdown (\`\`\` ani \`\`\`html) — zwróć samo HTML.
9. Każda treść musi być otoczona tagiem HTML — nie pisz tekstu poza tagami.
10. Długość: 300-500 słów.

Nie dodawaj ceny ani danych kontaktowych.
`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 1500,
  });

  return response.choices[0]?.message?.content || '';
}

// --- Fill form with AI ---

export async function fillFormWithAI(
  product: TyreProduct,
  categoryId?: string,
  categoryName?: string,
  categoryParams: AllegroParamDef[] = []
): Promise<Partial<AllegroFormData>> {
  const client = getClient();

  const attrs = product.extra_json?.attrs || {};

  // Max dictionary entries to show AI — prevents prompt bloat
  const DICT_LIMIT = 40;

  const trimDict = (p: AllegroParamDef, hint?: string): AllegroParamDictValue[] => {
    const dict = p.dictionary || [];
    if (dict.length <= DICT_LIMIT) return dict;
    if (hint) {
      const q = hint.toLowerCase();
      const idx = dict.findIndex((v) => v.value.toLowerCase().includes(q) || q.includes(v.value.toLowerCase()));
      if (idx >= 0) return dict.slice(Math.max(0, idx - 5), Math.max(0, idx - 5) + DICT_LIMIT);
    }
    return dict.slice(0, DICT_LIMIT);
  };

  const dictStr = (entries: AllegroParamDictValue[]) =>
    entries.map((v) => `${v.id}="${v.value}"`).join(', ');

  // Hint values per param name fragment (for trimming large dicts to relevant entries)
  const hints: Record<string, string> = {
    marka: product.brand || '', producent: product.brand || '',
    model: product.model || '',
    szerokość: product.width || '',
    profil: product.profile || '',
    średnica: product.diameter || '',
    'indeks nośności': product.load_index || '',
    'indeks prędkości': product.speed_index || '',
    sezon: product.season || '',
  };

  const paramsList = categoryParams.length > 0
    ? categoryParams.map((p) => {
        const hint = Object.entries(hints).find(([k]) => p.name.toLowerCase().includes(k))?.[1];
        const entries = trimDict(p, hint);
        const truncated = (p.dictionary?.length ?? 0) > DICT_LIMIT;
        const isMulti = p.restrictions?.multipleChoices;
        const dictPart = p.dictionary?.length
          ? `\n     Dozwolone ID: ${dictStr(entries)}${truncated ? ` … (${p.dictionary.length} total, pokazano ${entries.length})` : ''}`
          : '';
        return `  - id="${p.id}" name="${p.name}" type=${p.type}${p.required ? ' [WYMAGANY]' : ''}${isMulti ? ' [MULTI]' : ''}${dictPart}`;
      }).join('\n')
    : '  (brak parametrów kategorii)';

  const categorySection = categoryParams.length > 0
    ? `Kategoria Allegro: "${categoryName}" (ID: ${categoryId})\n\nParametry do wypełnienia w "params":\n${paramsList}`
    : categoryId
    ? `Kategoria ID: ${categoryId}${categoryName ? ` (${categoryName})` : ''}. Brak załadowanych parametrów.`
    : 'Brak wybranej kategorii.';

  // Extract any EAN/GTIN candidates from attrs
  const eanCandidates = Object.entries(attrs)
    .filter(([k]) => /ean|gtin|barcode|kod/i.test(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') || null;

  const prompt = `
Na podstawie danych produktu wypełnij formularz oferty Allegro. Zwróć TYLKO JSON.

${categorySection}

Dane produktu:
${JSON.stringify({
  brand: product.brand, model: product.model,
  width: product.width, profile: product.profile, diameter: product.diameter,
  season: product.season, condition: product.condition,
  load_index: product.load_index, speed_index: product.speed_index,
  xl: product.xl, runflat: product.runflat, snow_3pmsf: product.snow_3pmsf,
  wet_grip: product.wet_grip, rolling_resistance: product.rolling_resistance,
  noise_db: product.noise_db, vehicle_class: product.vehicle_class,
  price_gross: product.price_gross,
  qty: product.extra_json?.offer_qty || product.qty,
  size_raw: product.size_raw, attrs,
  tread_depth: product.extra_json?.tread_depth,
  dot_list: product.extra_json?.dot_list,
  production_year: product.production_year,
  ean_candidates: eanCandidates,
}, null, 2)}

Zwróć JSON:
{
  "title": "tytuł max 75 znaków",
  "price": liczba,
  "quantity": 1,
  "quantity_in_set": liczba sztuk w komplecie,
  "condition": "NEW" lub "USED",
  "shippingCost": 25,
  "shippingTime": "PT48H",
  "params": {
    "<id parametru>": "<wartość>"
  }
}

Zasady dla "params":
- Klucz = id parametru z listy powyżej
- Dla type=dictionary (MULTI=false): wartość = JEDEN dictEntryId (format "liczba_liczba", np. "344_8") — NIGDY etykieta tekstowa
- Dla type=dictionary [MULTI]: wartość = tablica dictEntryId, np. ["200981_1","200981_2"]
- Dla type=string/integer/float: wartość = string z wartością
- Uwzględnij WSZYSTKIE parametry [WYMAGANY]
- Dla parametrów EAN/GTIN/kod kreskowy: użyj wartości z ean_candidates jeśli dostępne; jeśli brak — wpisz "0000000000000" jako placeholder (nie pomijaj)
- Pomiń wyłącznie parametry których nie możesz określić na podstawie danych (nie dotyczy EAN)
- NIE zwracaj "categoryId" ani "categoryName"
`;

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_FILL_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  });

  try {
    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content) as Partial<AllegroFormData>;
    delete (parsed as Record<string, unknown>).categoryId;
    delete (parsed as Record<string, unknown>).categoryName;
    return parsed;
  } catch {
    return {};
  }
}

// --- Validate form data ---

export async function validateFormData(
  formData: Partial<AllegroFormData>,
  product: TyreProduct
): Promise<ValidationResult> {
  const client = getClient();

  const requiredFields = [
    'title',
    'categoryId',
    'description',
    'price',
    'quantity',
    'condition',
    'brand',
    'model',
    'width',
    'profile',
    'diameter',
    'season',
  ];

  const missingFields = requiredFields.filter(
    (f) => !formData[f as keyof AllegroFormData]
  );

  const prompt = `
Jesteś walidatorem ofert Allegro. Oceń poniższe dane formularza pod kątem poprawności i kompletności dla polskiego marketplace Allegro.

Dane formularza:
${JSON.stringify(formData, null, 2)}

Dane produktu z magazynu:
${JSON.stringify(
  {
    brand: product.brand,
    model: product.model,
    price_gross: product.price_gross,
    condition: product.condition,
    size: `${product.width}/${product.profile} R${product.diameter}`,
  },
  null,
  2
)}

Brakujące pola wymagane: ${missingFields.join(', ') || 'brak'}

Sprawdź:
1. Czy tytuł jest odpowiedni (max 75 znaków, zawiera kluczowe informacje)?
2. Czy cena jest sensowna (nie za niska, nie za wysoka) w stosunku do produktu?
3. Czy opis jest wystarczająco szczegółowy?
4. Czy wszystkie wymagane pola Allegro są wypełnione?
5. Czy parametry techniczne są spójne?
6. Czy ilość sztuk jest poprawna?

Zwróć TYLKO JSON:
{
  "valid": true/false,
  "score": liczba 0-100,
  "issues": ["lista problemów"],
  "suggestions": ["lista sugestii ulepszeń"],
  "summary": "krótkie podsumowanie po polsku"
}
`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 600,
    response_format: { type: 'json_object' },
  });

  try {
    const content = response.choices[0]?.message?.content || '{}';
    const result = JSON.parse(content);
    return {
      valid: result.valid ?? false,
      score: result.score ?? 0,
      issues: result.issues ?? [],
      suggestions: result.suggestions ?? [],
      summary: result.summary ?? '',
    };
  } catch {
    return {
      valid: false,
      score: 0,
      issues: ['Błąd walidacji AI'],
      suggestions: [],
      summary: 'Nie udało się przeprowadzić walidacji',
    };
  }
}
