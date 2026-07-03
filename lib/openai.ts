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

// --- Suggest Allegro category ---

export interface AllegroCategory {
  id: string;
  name: string;
  leaf?: boolean;
  path?: string;   // pełna ścieżka, np. "Dom i Ogród/Meble/Przedpokój/Konsole"
}

export async function suggestCategoryWithAI(
  product: TyreProduct,
  candidates: AllegroCategory[]
): Promise<{ categoryId: string; categoryName: string } | null> {
  if (candidates.length === 0) return null;
  const client = getClient();

  const list = candidates
    .map((c) => `id="${c.id}" name="${c.name}"${c.path ? ` ścieżka="${c.path}"` : ''}${c.leaf ? ' [LIŚĆ]' : ''}`)
    .join('\n');

  const sourcePath = product.breadcrumbs || (product.cats && product.cats.length ? product.cats.join(' / ') : '');

  const prompt = `Dopasowujesz produkt MEBLOWY do drzewa kategorii Allegro.

Produkt:
- Nazwa: ${product.name}
- Model: ${product.model}
- Typ/kategoria sklepowa: ${product.kind || 'mebel'}${sourcePath ? `\n- Ścieżka kategorii w sklepie: ${sourcePath}` : ''}

Lista kandydatów Allegro (wybierz dokładnie jeden, najlepiej pasujący semantycznie do produktu i jego ścieżki sklepowej):
${list}

Zasady:
- Wybierz WYŁĄCZNIE kategorię z powyższej listy (przepisz dokładnie jej id).
- Preferuj kategorie-liście [LIŚĆ] (na nich można wystawiać oferty).
- Kieruj się znaczeniem mebla i ścieżką sklepową, nie samym dopasowaniem słów.

Zwróć TYLKO JSON: {"categoryId": "<id z listy>", "categoryName": "<name z listy>"}`;


  console.log(prompt);
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 60,
    response_format: { type: 'json_object' },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}') as { categoryId?: string; categoryName?: string };
    if (!parsed.categoryId) return null;

    // Model bywa, że zwraca nazwę zamiast numerycznego ID (np. "fotel") — to powoduje 404
    // przy /api/allegro/categories/<id>. Akceptujemy tylko ID realnie istniejące na liście kandydatów.
    const byId = candidates.find((c) => String(c.id) === String(parsed.categoryId));
    const match = byId
      ?? candidates.find((c) => c.name.toLowerCase() === (parsed.categoryName || '').toLowerCase())
      ?? candidates.find((c) => c.name.toLowerCase() === String(parsed.categoryId).toLowerCase());
    if (!match) return null;
    return { categoryId: String(match.id), categoryName: match.name };
  } catch {
    return null;
  }
}

// --- Generate Allegro description ---

export async function generateDescription(
  product: TyreProduct,
  _formData: Partial<AllegroFormData>
): Promise<string> {
  const client = getClient();

  const prompt = `
Jesteś ekspertem sprzedaży mebli na Allegro i Empik. Napisz profesjonalny, przekonujący opis aukcji w języku polskim.

Dane produktu: ${JSON.stringify(product)}

Wymagania opisu:
1. Zacznij od krótkiego wstępu o meblu (nazwa, model, przeznaczenie wnętrzarskie)
2. Wylistuj kluczowe cechy i zalety (materiał korpusu i podstawy, kolor, funkcje np. szuflady)
3. Podaj szczegółowe wymiary (szerokość, głębokość/długość, wysokość) oraz wagę, jeśli dostępne
4. Wspomnij o stanie produktu (${product.condition === 'used' ? 'używany' : 'nowy'})
5. Zamiast SKU używaj pojęcia "Nr katalogowy" i pilnuj poprawnej nazwy modelu — to ważne
6. Nie wymyślaj cech, których nie ma w danych produktu
7. Użyj TYLKO dozwolonych znaczników HTML: <h1> (tytuł), <h2> (podtytuł), <p> (akapit), <ul>/<ol>/<li> (listy), <b> (pogrubienie). NIE używaj: h3, h4, h5, h6, strong, em, div, span ani żadnych innych tagów.
8. NIE owijaj opisu w bloki markdown (\`\`\` ani \`\`\`html) — zwróć samo HTML.
9. Długość: 300-500 słów.


Nie dodawaj ceny ani danych kontaktowych oraz informacji o wysyłce i nie pisz podsumowań w stylu zapraszamy do zakupu.
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
Na podstawie danych produktu wypełnij formularz oferty Allegro, Zacznic od szukania  informacji  nazwie produktu a nastepnie  w atrybutach. Następnie sprawdz poprawność tego co zwracasz jak jest ok  Zwróć TYLKO JSON. Staraj się dopasowywać 1:1 wartosci - jak masz problem wybierz wartosc inna. Allegro sprawdza krzyzowo wartosci parametrów czy pasuja wzajemnie wiec nie mozna kombinowac.

${categorySection}

Dane produktu (pełny JSON z Typesense):
${JSON.stringify({ ...product, ean_candidates: eanCandidates }, null, 2)}

Zwróć JSON:
{
  "title": "tytuł max 75 znaków",
  "price": liczba,
  "quantity": 1,
  "quantity_in_set": liczba sztuk w komplecie,
  "condition": "NEW" lub "USED",
  "shippingCost": 25,
  "shippingTime": "PT24H",
  "params": {
    "<id parametru>": "<wartość>"
  }
}

Zasady dla "title":
- Maks. 75 znaków
- NIE używaj słowa "używane" ani "używana" w żadnej formie
- Zawsze uwzględnij sezon opon: "letnie", "zimowe" lub "całoroczne" (na podstawie pola season produktu)
- Jeśli condition=USED: brak sufiksu
- Jeśli condition=NEW (nieużywane): sprawdź rok produkcji (production_year lub dot_list):
  * Rok produkcji >= ${new Date().getFullYear() - 2} → dodaj na końcu " NOWE"
  * Rok produkcji < ${new Date().getFullYear() - 2} → dodaj na końcu " Nieużywane"

Zasady dla "params":
- Klucz = id parametru z listy powyżej
- Nie wprowadzaj wartości typu 000000
- Dla type=dictionary (MULTI=false): wartość = JEDEN dictEntryId (format "liczba_liczba", np. "344_8") — NIGDY etykieta tekstowa
- Dla type=dictionary [MULTI]: wartość = tablica dictEntryId, np. ["200981_1","200981_2"]
- Dla type=string/integer/float: wartość = string z wartością
- Uwzględnij WSZYSTKIE parametry [WYMAGANY]
- Dla parametrów EAN/GTIN/kod kreskowy: użyj wartości z ean_candidates jeśli dostępne; jeśli brak — zostaw puste pole
- Pomiń wyłącznie parametry których nie możesz określić na podstawie danych (nie dotyczy EAN)
- NIE zwracaj "categoryId" ani "categoryName"
`;

  console.log('gpt-5.4-mini');
  // const response = await client.chat.completions.create({
  //   model: process.env.OPENAI_FILL_MODEL || 'gpt-5.4-mini',
  //   messages: [{ role: 'user', content: prompt }],
  //   temperature: 0.2,
  //   max_tokens: 1500,
  //   response_format: { type: 'json_object' },
  // });
  const response = await client.responses.create({
    model: process.env.OPENAI_FILL_MODEL || 'gpt-5.4-mini',
    input: prompt,
    temperature: 0.2,
    max_output_tokens: 1500,
  });

  try {
    const content = response.output_text || '{}';
    const parsed = JSON.parse(content);

    delete parsed.categoryId;
    delete parsed.categoryName;

    return parsed;
  } catch {
    return {};
  }
}

// --- Fix form data based on Allegro error ---

export interface AIFixChange {
  field: string;
  was: string;
  fixed: string;
  reason: string;
}

export interface AIFixResult {
  formData: Partial<AllegroFormData>;
  changes: AIFixChange[];
  summary: string;
}

export async function fixFormWithAI(
  product: TyreProduct,
  formData: Partial<AllegroFormData>,
  allegroError: string,
  categoryParams: AllegroParamDef[] = []
): Promise<AIFixResult> {
  const client = getClient();

  let errorMessages = allegroError;
  const dictErrorParamIds = new Set<string>();
  try {
    const m = allegroError.match(/Allegro API \d+: (.+)/);
    if (m) {
      const obj = JSON.parse(m[1]) as { errors?: { userMessage?: string; message?: string; code?: string; metadata?: { parameterId?: string } }[] };
      errorMessages = (obj.errors || [])
        .map((e) => {
          if (e.code === 'DictionaryParameterIdNotFound' && e.metadata?.parameterId) {
            dictErrorParamIds.add(e.metadata.parameterId);
          }
          return `[${e.code}] ${e.userMessage || e.message || ''} ${JSON.stringify(e.metadata || '')}`;
        })
        .join('\n');
    }
  } catch { /* use raw string */ }

  const paramsList = categoryParams.length > 0
    ? categoryParams.map((p) => {
      // For params with DictionaryParameterIdNotFound errors, show the full dictionary
      const showFull = dictErrorParamIds.has(p.id);
      const dict = (showFull ? p.dictionary : p.dictionary?.slice(0, 30))
        ?.map((d) => `${d.id}="${d.value}"`).join(', ') || '';
      return `  id="${p.id}" name="${p.name}" type=${p.type}${p.required ? ' [WYMAGANY]' : ''}${dict ? `\n    Opcje: ${dict}` : ''}`;
    }).join('\n')
    : '  (brak)';

  const prompt = `Oferta na Allegro została odrzucona. Przeanalizuj błędy, napraw formularz i wyjaśnij zmiany.

BŁĘDY ALLEGRO:
${errorMessages}

AKTUALNE DANE FORMULARZA:
${JSON.stringify(formData, null, 2)}

DANE PRODUKTU (brand/model/size):
${product.brand} ${product.model} ${product.size_raw || ''}, stan: ${product.condition}

DOSTĘPNE PARAMETRY KATEGORII:
${paramsList}

Zwróć JSON w dokładnie tym formacie:
{
  "summary": "Krótkie podsumowanie (1-2 zdania) co było nie tak",
  "changes": [
    {
      "field": "nazwa pola (np. params.12345 lub title)",
      "was": "stara wartość lub '(puste)'",
      "fixed": "nowa wartość",
      "reason": "dlaczego ta zmiana naprawia błąd"
    }
  ],
  "formData": {
    // TYLKO zmienione pola — te same co w changes
  }
}

Zasady:
- Napraw TYLKO pola których dotyczą błędy
- Dla type=dictionary: wartość = dictEntryId (np. "344_8"), NIE tekst słowny
- NIE zwracaj categoryId ani categoryName w formData
- Jeśli błąd dotyczy parametru o id X, klucz w formData.params to "X"`;

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_FILL_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}') as {
      summary?: string;
      changes?: AIFixChange[];
      formData?: Partial<AllegroFormData>;
    };
    const fd = parsed.formData || {};
    delete (fd as Record<string, unknown>).categoryId;
    delete (fd as Record<string, unknown>).categoryName;
    return {
      formData: fd,
      changes: parsed.changes || [],
      summary: parsed.summary || 'AI naprawiło formularz',
    };
  } catch {
    return { formData: {}, changes: [], summary: 'Nie udało się przeanalizować odpowiedzi AI' };
  }
}

// --- Validate form data ---

export async function validateFormData(
  formData: Partial<AllegroFormData>,
  product: TyreProduct,
  categoryParams: any
): Promise<ValidationResult> {
  const client = getClient();

  // Only check fields that actually exist in AllegroFormData
  const requiredFields: (keyof AllegroFormData)[] = [
    'title',
    'categoryId',
    'description',
    'price',
    'quantity',
    'condition',
  ];

  const missingFields = requiredFields.filter((f) => {
    const v = formData[f];
    if (v === undefined || v === null || v === '') return true;
    if (typeof v === 'number' && v <= 0) return true;
    return false;
  });

  const paramsCount = Object.keys(formData.params || {}).length;


  const prompt = `
Jesteś walidatorem ofert Allegro. Oceń poniższe dane formularza pod kątem poprawności i kompletności dla polskiego marketplace Allegro.

Dane formularza (wypełnione przez AI):
- Tytuł: ${formData.title || '(brak)'}
- Kategoria: ${formData.categoryName || formData.categoryId || '(brak)'}
- Cena - pomin ten szczegol.
- Ilość: ${formData.quantity ?? '(brak)'} szt.
- Stan: ${formData.condition || '(brak)'}
- Opis (${(formData.description || '').length} znaków): ${(formData.description || '').slice(0, 200)}...
- Parametry Allegro wypełnione: ${paramsCount} pól
- Zdjęcia: ${(formData.images || []).length} szt.

Dane produktu z magazynu (źródło prawdy):
- Marka: ${product.brand}
- Model: ${product.model}
- Rozmiar: ${product.width}/${product.profile} R${product.diameter}
- Indeksy: ${product.load_index ?? ''}${(product.speed_index || '').toUpperCase()}
- Sezon: ${product.season}
- Stan: ${product.condition}
- Cena zakupu: ${product.price_gross} zł



Brakujące pola wymagane formularza: ${missingFields.length > 0 ? missingFields.join(', ') : 'brak'}

Sprawdź:
1. Czy tytuł jest odpowiedni (max 75 znaków, zawiera markę/model/rozmiar/sezon)?
2. Czy opis jest wystarczająco szczegółowy (min 200 znaków)?
3. Czy wszystkie wymagane pola są wypełnione?
4. Czy parametry Allegro (${paramsCount} pól) wyglądają kompletnie?


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

// --- Generate per-account title variants ---
export async function generateAccountTitles(
  baseTitle: string,
  product: TyreProduct,
  accounts: { account_id: string; account_name: string }[]
): Promise<Record<string, string>> {
  if (accounts.length === 0) return {};

  // ── Wyciągamy dane z produktu ──────────────────────────────────────────────
  const brand     = product.brand || '';
  const model     = product.model || product.pattern || '';
  const width     = product.width || '';
  const profile   = product.profile || product.load_index || '';
  const diameter  = product.diameter || '';
  const size      = `${width}/${profile} R${diameter}`;          // 245/45 R18

  const speedIdx  = (product.speed_index || '').toUpperCase();   // W
  const loadIdx   = product.extra_json?.ebay_category?.['Indeks nośności'] || ''; // 100
  const index     = `${loadIdx}${speedIdx}`;                     // 100W

  const qty       = product.qty ?? 1;

  // Sezon
  const seasonRaw = (product.season || '').toLowerCase();
  const seasonSingular = seasonRaw === 'lato' ? 'Letnia'
    : seasonRaw === 'zima'                    ? 'Zimowa'
    : seasonRaw === 'całoroczna'              ? 'Całoroczna'
    : '';
  const seasonPlural = seasonRaw === 'lato'  ? 'Letnie'
    : seasonRaw === 'zima'                   ? 'Zimowe'
    : seasonRaw === 'całoroczna'             ? 'Całoroczne'
    : '';
  const seasonShort = seasonRaw === 'lato'   ? 'L'
    : seasonRaw === 'zima'                   ? 'Z'
    : seasonRaw === 'całoroczna'             ? 'C'
    : '';

  // Cechy — słownie (strategia 1)
  const featuresVerbose: string[] = [];
  if (product.xl || product.reinforced
      || product.extra_json?.attrs?.['Extra Load / Reinforced / XL'] === 'Tak') {
    featuresVerbose.push('Wzmocniona');
  }
  if (product.runflat
      || product.extra_json?.runflat_detected) {
    featuresVerbose.push('RunFlat');
  }
  const homol = product.extra_json?.attrs?.['Homologacje'] || '';
  if (homol) featuresVerbose.push(homol);       // np. VOL, BMW, MO…

  // Cechy — skróty (strategia 2)
  const featuresShort: string[] = [];
  if (product.xl || product.reinforced
      || product.extra_json?.attrs?.['Extra Load / Reinforced / XL'] === 'Tak') {
    featuresShort.push('XL');
  }
  if (product.runflat || product.extra_json?.runflat_detected) {
    featuresShort.push('RF');
  }
  if (homol) featuresShort.push(homol);

  // ── Pomocnicza: utnij do max 75 znaków bez urywania słowa ─────────────────
  function fitTo75(parts: string[]): string {
    const joined = parts.filter(Boolean).join(' ');
    if (joined.length <= 75) return joined;
    // Utnij na ostatniej spacji mieszczącej się w 75 znakach
    return joined.slice(0, 75).replace(/\s+\S*$/, '').trimEnd();
  }

  // ── Strategia 1: "ALLEGRO PRODUKTY" ───────────────────────────────────────
  // Schemat: [Ilość]× Opona [sezon sing.] [Marka] [Model] [Rozmiar] [Indeks] [Cechy słownie]
  const title1Parts = [
    `${qty}×`,
    'Opona',
    seasonSingular,
    brand,
    model,
    size,
    index,
    ...featuresVerbose,
  ];
  const title1 = fitTo75(title1Parts);

  // ── Strategia 2: "SEARCH FRAZY" ───────────────────────────────────────────
  // Schemat: [Marka] [Model] [Rozmiar] [Indeks] [Skróty] Opony [Sezon] [Ilość]sz
  const title2Parts = [
    brand.toUpperCase(),
    model.toUpperCase(),
    size,
    index,
    ...featuresShort,
    'Opony',
    seasonPlural,
    `${qty}szt`,
  ];
  const title2 = fitTo75(title2Parts);

  // ── Przypisz do kont ───────────────────────────────────────────────────────
  const result: Record<string, string> = {};
  if (accounts[0]) result[accounts[0].account_id] = title1;
  if (accounts[1]) result[accounts[1].account_id] = title2;

  // Jeśli kont jest więcej — alternuj strategie
  for (let i = 2; i < accounts.length; i++) {
    result[accounts[i].account_id] = i % 2 === 0 ? title1 : title2;
  }

  return result;
}


export async function _generateAccountTitles(
  baseTitle: string,
  product: TyreProduct,
  accounts: { account_id: string; account_name: string }[]
): Promise<Record<string, string>> {
  if (accounts.length === 0) return {};
  const client = getClient();
  const FILL_MODEL = process.env.OPENAI_FILL_MODEL || 'gpt-4o-mini';

  const accountList = accounts.map((a) => `"${a.account_id}": "${a.account_name}"`).join('\n');
  const prompt = `Masz tytuł aukcji na Allegro:
"${product.name}"


Wygeneruj DWA RÓŻNE warianty tytułu na podstawie glownego tytlu— po jednym dla każdego konta — stosując DWIE RÓŻNE STRATEGIE . Cel: oferty mają łapać różne intencje wyszukiwania bez kanibalizacji - nie dodawaj nic od Siebie po za  tym  co jest w tytutle.

═══════════════════════════════════════
STRATEGIE (przypisz po jednej do każdego konta z listy poniżej, w kolejności):
═══════════════════════════════════════

▶ KONTO 1 — Strategia "ALLEGRO PRODUKTY" (95% top-ofert używanych opon)
Schemat: [Ilość]× Opona [sezon w l. poj.] [Marka] [Model] [Rozmiar] [Indeks] [Cechy słownie] [Homologacja]

▶ KONTO 2 — Strategia "SEARCH FRAZY" (klasyczne SEO pod wyszukiwarkę)
Schemat:  [MARKA] [MODEL] [ROZMIAR] [INDEKS] [SKRÓTY] OPONY [SEZON] [ILOŚĆ]SZ



WAŻNE: Oba tytuły muszą być WIDOCZNIE różne — różny znak ilości (× vs x), różna liczba gramatyczna ("Opona letnia" vs "opony letnie"), różny zapis cech (rozwinięte vs skróty).

═══════════════════════════════════════
ZASADY WSPÓLNE DLA OBU TYTUŁÓW:
═══════════════════════════════════════

FORMAT:
- Maksymalnie 75 znaków (twardy limit Allegro)
- staraj się formułować tak te 75 znaków by nie ucinac ostatniego wyrazu - jak ucinasz to postaraj się skrócić nazwę.
- Język polski
- Bez WERSALIKÓW całych słów
- Bez znaków specjalnych jako ozdobników (!, @, []) — dozwolone tylko gdy są częścią nazwy modelu lub homologacji ("Primacy 4+", "* - BMW")

═══════════════════════════════════════

Konta:
${accountList}

Zwróć TYLKO poprawny JSON (bez komentarzy, bez markdown, bez \`\`\`), gdzie kluczem jest account_id w kolejności z listy powyżej (pierwszy account = strategia "Allegro Produkty", drugi account = strategia "Search Frazy"):

{
  "account_id_1": "tytuł wg strategii Allegro Produkty",
  "account_id_2": "tytuł wg strategii Search Frazy"
}`;

  console.log(prompt);

  const response = await client.chat.completions.create({
    model: FILL_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    max_tokens: 300,
    response_format: { type: 'json_object' },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}') as Record<string, string>;
    // Trim to 75 chars just in case
    for (const key of Object.keys(parsed)) {
      if (typeof parsed[key] === 'string') parsed[key] = parsed[key].slice(0, 75);
    }
    return parsed;
  } catch {
    return {};
  }
}
