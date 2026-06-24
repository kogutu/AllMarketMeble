# Dokumentacja kodu — Allegro Panel

## Spis treści
1. [Zmienne środowiskowe (.env.local)](#1-zmienne-środowiskowe)
2. [Baza danych (MySQL)](#2-baza-danych)
3. [Prompty AI (lib/openai.ts)](#3-prompty-ai)
4. [Payload Allegro (lib/allegro.ts)](#4-payload-allegro)
5. [Typy formularza (types/index.ts)](#5-typy-formularza)
6. [Formularz wystawiania (AllegroForm.tsx)](#6-formularz-wystawiania)
7. [Panel kont i marż (AccountPanels.tsx)](#7-panel-kont-i-marż)
8. [Nawigacja / Sidebar](#8-nawigacja--sidebar)
9. [Dodawanie nowych pól — krok po kroku](#9-dodawanie-nowych-pól)

---

## 1. Zmienne środowiskowe

**Plik:** [.env.local](./.env.local)

| Zmienna | Co zmienia |
|---|---|
| `OPENAI_MODEL` | Model używany do opisu i walidacji (domyślnie `gpt-4o`) |
| `OPENAI_FILL_MODEL` | Model do wypełniania formularza i naprawy błędów (domyślnie `gpt-4o-mini`) |
| `ALLEGRO_ENV` | `production` lub `sandbox` — przełącza URL API Allegro |
| `NEXT_PUBLIC_ALLEGRO_ENV` | Jak wyżej, ale dostępna w przeglądarce (linki do aukcji) |
| `ALLEGRO_RETURN_POLICY_ID` | ID polityki zwrotów (tylko sandbox — na produkcji pobierane z API) |
| `ALLEGRO_IMPLIED_WARRANTY_ID` | ID rękojmi (tylko sandbox) |
| `ALLEGRO_SHIPPING_RATE_ID` | Ręcznie ustaw ID cennika wysyłki żeby pominąć pobieranie z API |
| `ALLEGRO_SAFETY_DESCRIPTION` | Tekst GPSR (informacje o bezpieczeństwie) — domyślny jest w kodzie |
| `ALLEGRO_PRODUCER_NAME/STREET/CITY/...` | Dane producenta/importera (GPSR) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Login do panelu |
| `ADMIN_TOKEN` | Token cookie sesji — zmień przed deployem |

---

## 2. Baza danych

**Plik ze schematem:** [scripts/schema.sql](./scripts/schema.sql)
**Plik migracji nowych tabel:** [scripts/migrate-offer-accounts.sql](./scripts/migrate-offer-accounts.sql)

### Tabele

| Tabela | Do czego |
|---|---|
| `allegro_tokens` | Tokeny OAuth per konto Allegro |
| `allegro_offers` | Drafty ofert — jeden wiersz per produkt (form_data jako JSON) |
| `allegro_offer_accounts` | Wystawione oferty per konto — jeden wiersz per (produkt × konto) |
| `allegro_publish_errors` | Log błędów z Allegro — widoczny na stronie `/errors` |
| `margin_rules` | Reguły marż per konto i kategoria |
| `product_price_overrides` | Ręczne nadpisania cen per (produkt × konto) |

### Gdzie dodać nowe pole do draftu oferty

Pole `form_data` w `allegro_offers` to JSON — nie trzeba migrować kolumny, wystarczy dodać pole do interfejsu TypeScript (patrz sekcja 5).

---

## 3. Prompty AI

**Plik:** [lib/openai.ts](./lib/openai.ts)

### Funkcje i gdzie są ich prompty

#### [`fillFormWithAI()`](./lib/openai.ts#L101) — linia 101
Wypełnia pola formularza na podstawie danych produktu i parametrów kategorii.
- **Prompt:** [lib/openai.ts#L165](./lib/openai.ts#L165)
- **Co możesz zmienić:** zasady dla `params`, format JSON odpowiedzi, instrukcje dotyczące EAN, limit słownika [`DICT_LIMIT = 40`](./lib/openai.ts#L112) (ile opcji słownikowych widzi AI)
- **Model:** `OPENAI_FILL_MODEL` (domyślnie `gpt-4o-mini`)

#### [`generateDescription()`](./lib/openai.ts#L64) — linia 64
Generuje opis HTML oferty.
- **Prompt:** [lib/openai.ts#L70](./lib/openai.ts#L70)
- **Co możesz zmienić:** styl opisu, wymagane sekcje, długość (300-500 słów), dozwolone tagi HTML, instrukcje dotyczące stanu opony
- **Model:** `OPENAI_MODEL` (domyślnie `gpt-4o`)
- **Temperatura:** 0.7 — obniż dla bardziej przewidywalnych opisów

#### [`validateFormData()`](./lib/openai.ts#L293) — linia 293
Waliduje wypełniony formularz przed wystawieniem.
- **Prompt:** [lib/openai.ts#L316](./lib/openai.ts#L316)
- **Co możesz zmienić:** listę sprawdzanych pól ([`requiredFields`](./lib/openai.ts#L299)), punkty kontrolne w prompcie, skalę oceny (0-100)
- **Model:** `OPENAI_MODEL`

#### [`fixFormWithAI()`](./lib/openai.ts#L219) — linia 219
Naprawia formularz po błędzie z Allegro (przycisk "✨ Napraw AI").
- **Prompt:** [lib/openai.ts#L246](./lib/openai.ts#L246)
- **Co możesz zmienić:** instrukcje naprawy, format błędów
- **Model:** `OPENAI_FILL_MODEL`

#### [`suggestCategoryWithAI()`](./lib/openai.ts#L26) — linia 26
Wybiera kategorię Allegro z listy kandydatów.
- **Prompt:** [lib/openai.ts#L37](./lib/openai.ts#L37)
- **Co możesz zmienić:** format opisu produktu w prompcie
- **Model:** zawsze `gpt-4o-mini` (hard-coded, szybki wybór)

---

## 4. Payload Allegro

**Plik:** [lib/allegro.ts](./lib/allegro.ts)

### [`buildAllegroPayload()`](./lib/allegro.ts#L578) — linia 578

Tu budowany jest JSON wysyłany do Allegro `POST /sale/product-offers`.

**Struktura payloadu:**
```
productSet[0]
  product.name          ← form.title
  product.category.id   ← form.categoryId
  product.parameters    ← params z kategorii produktu
  product.images        ← form.images
  responsibleProducer   ← zmienne ALLEGRO_PRODUCER_*
  safetyInformation     ← ALLEGRO_SAFETY_DESCRIPTION lub default

name                    ← form.title
description             ← form.description (HTML)
parameters              ← params z kategorii oferty
images                  ← form.images
external.id             ← form.sku
sellingMode.price       ← form.price
stock.available         ← form.quantity
delivery.handlingTime   ← form.shippingTime
delivery.shippingRates  ← pobrane z API lub ALLEGRO_SHIPPING_RATE_ID
afterSalesServices      ← pobrane z API lub zmienne env (sandbox)
```

**Gdzie dodać nowe pole Allegro:**
- Pola na poziomie oferty (np. `location`, `payments`) → dodaj do `return { ... }` na końcu funkcji — [lib/allegro.ts#L672](./lib/allegro.ts#L672)
- Pola wewnątrz produktu (np. nowy atrybut) → dodaj do `product: { ... }` w `productSetEntry` — [lib/allegro.ts#L654](./lib/allegro.ts#L654)

**Filtrowanie parametrów (co jest pomijane):**
- EAN z wartością `"0000000000000"` — [lib/allegro.ts#L622](./lib/allegro.ts#L622)
- Parametry `integer`/`float` z wartością `"0"` — [lib/allegro.ts#L624](./lib/allegro.ts#L624)
- Nieznane `paramId` (nie ma w definicji kategorii) — [lib/allegro.ts#L636](./lib/allegro.ts#L636)

### [`createOffer()`](./lib/allegro.ts#L340) — linia 340

Wysyła payload do Allegro. Zawiera **auto-fix PARAMETER_MISMATCH** — jeśli Allegro zwróci błąd dopasowania parametrów, automatycznie poprawia `expectedParameterValueId` i ponawia.

### [`getFirstShippingRate()`](./lib/allegro.ts#L558) / [`getFirstAfterSalesService()`](./lib/allegro.ts#L301)

Pobierają pierwsze dostępne ID z Allegro API. Możesz zablokować przez zmienne env (`ALLEGRO_SHIPPING_RATE_ID` itp.).

---

## 5. Typy formularza

**Plik:** [types/index.ts](./types/index.ts) — interfejs [`AllegroFormData`](./types/index.ts#L67)

```ts
export interface AllegroFormData {
  title: string;
  sku: string;          // external.id w Allegro
  categoryId: string;
  categoryName: string;
  description: string;
  price: number;
  quantity: number;
  quantity_in_set: number;
  condition: 'NEW' | 'USED';
  images: string[];
  shippingCost: number;
  shippingTime: string;
  params: Record<string, string | string[]>;  // parametry Allegro (paramId → wartość)
}
```

**Dodanie nowego pola formularza:**
1. Dodaj pole tutaj
2. Dodaj wartość domyślną w `EMPTY_FORM` w `AllegroForm.tsx` (linia ~19)
3. Dodaj obsługę w `buildAllegroPayload()` w `lib/allegro.ts`
4. Opcjonalnie: dodaj do prompta `fillFormWithAI()` w `lib/openai.ts`

---

## 6. Formularz wystawiania

**Plik:** [components/offers/AllegroForm.tsx](./components/offers/AllegroForm.tsx)

### Kluczowe miejsca

| Co | Gdzie |
|---|---|
| Domyślne wartości formularza | [`EMPTY_FORM`](./components/offers/AllegroForm.tsx#L19) |
| Pre-fill parametrów z danych produktu (bez AI) | [`prefillParamsFromProduct()`](./components/offers/AllegroForm.tsx#L232) |
| Sekwencja auto-fill AI po wyborze kategorii | [`useEffect` z `run()`](./components/offers/AllegroForm.tsx#L456) |
| Sugerowanie kategorii (po wczytaniu draftu) | [`useEffect` suggest](./components/offers/AllegroForm.tsx#L442) |
| Blokada publish (wymagane pola) | [`missingRequired`](./components/offers/AllegroForm.tsx#L552) |
| Przycisk "✨ Wypełnij" | [`handleAIFill()`](./components/offers/AllegroForm.tsx#L567) |
| Przycisk "📝 Opis" | [`handleGenerateDescription()`](./components/offers/AllegroForm.tsx#L597) |
| Przycisk "🔍 Waliduj" | [`handleValidate()`](./components/offers/AllegroForm.tsx#L616) |
| Przycisk "🚀 Wystaw" | [`handlePublish()`](./components/offers/AllegroForm.tsx#L667) |
| Przycisk "✨ Napraw AI i ponów" | [`handleAIFix()`](./components/offers/AllegroForm.tsx#L718) |

### Wymagane pola przed wystawieniem

[`missingRequired`](./components/offers/AllegroForm.tsx#L552) — lista parametrów z `categoryParams` gdzie `required === true` i brak wartości w `form.params`. Nie możesz tu dodać własnych pól — lista pochodzi z definicji kategorii Allegro.

### Migracja starych danych formularza

[`migrateOldFormData()`](./components/offers/AllegroForm.tsx#L1193) — konwertuje stary format formularza (płaskie pola) do nowego (params jako mapa). Jeśli zmieniasz strukturę `AllegroFormData`, tutaj dodaj migrację.

---

## 7. Panel kont i marż

**Plik:** [components/products/AccountPanels.tsx](./components/products/AccountPanels.tsx)

Wyświetlany nad formularzem na stronie `/products/[id]/add-to-allegro`.

### Polling po wystawieniu

[AccountPanels.tsx#L69](./components/products/AccountPanels.tsx#L69):
```ts
const POLL_INTERVAL_MS = 4000;  // co ile ms odpytuje DB
const POLL_MAX_COUNT = 6;       // ile razy (łącznie ~24s)
```

Zmień te stałe jeśli chcesz krótszy/dłuższy polling.

### Statusy oferty Allegro

[`statusBadge()`](./components/products/AccountPanels.tsx#L50) — obsługuje: `ACTIVE`, `INACTIVE`, `ENDED`, `PENDING`. Dodaj nowe statusy tutaj.

### Linki do Allegro

[`allegroEditUrl()`](./components/products/AccountPanels.tsx#L60) i [`allegroViewUrl()`](./components/products/AccountPanels.tsx#L64). Aktualnie:
- Edit: `salescenter.allegro.com/offer/{id}/restore`
- View: `allegro.pl/oferta/{id}`

---

## 8. Nawigacja / Sidebar

**Plik:** [components/layout/Sidebar.tsx](./components/layout/Sidebar.tsx)

Tablica [`nav`](./components/layout/Sidebar.tsx#L7) na górze pliku — dodaj nową pozycję menu tutaj:
```ts
{
  label: 'Nowa strona',
  href: '/nowa-strona',
  icon: (<svg>...</svg>),
}
```

---

## 9. Dodawanie nowych pól

### Nowe pole formularza Allegro (np. `location`)

1. [types/index.ts#L67](./types/index.ts#L67) → dodaj `location: string` do `AllegroFormData`
2. [AllegroForm.tsx#L19](./components/offers/AllegroForm.tsx#L19) → dodaj `location: ''` do `EMPTY_FORM`
3. [AllegroForm.tsx](./components/offers/AllegroForm.tsx) → dodaj `<input>` w sekcji formularza
4. [lib/allegro.ts#L672](./lib/allegro.ts#L672) → dodaj `location: data.location` do `return { ... }` w `buildAllegroPayload()`
5. Opcjonalnie: [lib/openai.ts#L173](./lib/openai.ts#L173) → dodaj `"location": "..."` do schematu JSON w `fillFormWithAI()`

### Nowy prompt AI

1. Dodaj funkcję w [lib/openai.ts](./lib/openai.ts) wzorując się na [`fillFormWithAI()`](./lib/openai.ts#L101)
2. Utwórz endpoint w `app/api/ai/[nazwa]/route.ts` wzorując się na [app/api/ai/fill/route.ts](./app/api/ai/fill/route.ts)
3. Wywołaj z komponentu

### Nowa strona w panelu

1. Utwórz `app/[nazwa]/page.tsx` wzorując się na [app/margins/page.tsx](./app/margins/page.tsx)
2. Dodaj do [`nav`](./components/layout/Sidebar.tsx#L7) w [Sidebar.tsx](./components/layout/Sidebar.tsx)
3. Opcjonalnie dodaj API w `app/api/[nazwa]/route.ts`

### Nowa kolumna w tabeli DB

1. Dodaj `ALTER TABLE` do [scripts/schema.sql](./scripts/schema.sql) (w komentarzu migracji)
2. Wywołaj przez `POST /api/admin/migrate` ([app/api/admin/migrate/route.ts](./app/api/admin/migrate/route.ts)) lub bezpośrednio na bazie
3. Zaktualizuj interfejs TypeScript w [types/index.ts](./types/index.ts)
