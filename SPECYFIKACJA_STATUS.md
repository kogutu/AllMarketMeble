# Status realizacji specyfikacji Allegro Panel

---

## ZROBIONE

### 1. Lista produktów z miniaturkami
- Produkty zasysane z Typesense (stary sklep jako źródło) — lista z miniaturkami w `/products`
- Przy każdym produkcie przycisk przejścia do wystawiania na Allegro

### 2. Wielokontowość (MAN / RAD)
- Obsługa wielu kont Allegro w systemie (tabela `allegro_tokens`)
- Publikacja osobno na każde konto — przyciski per konto w formularzu wystawiania
- Tabela `allegro_offer_accounts` — jeden wiersz per (produkt × konto)
- Oznaczenia statusu oferty osobno dla każdego konta (zielona = aktywna, szara = nie wystawiona, żółta = nieaktywna, czerwona = zakończona)

### 3. Formularz wystawiania z auto-wypełnianiem AI
- Parametry kategorii Allegro wypełniane automatycznie przez AI (GPT-4o-mini) na podstawie danych produktu
- Opis HTML generowany przez AI
- Walidacja wypełnionego formularza przed wysłaniem
- Auto-naprawa błędów Allegro (PARAMETER_MISMATCH + przycisk "✨ Napraw AI")
- Zdjęcia w kolejności ze starego sklepu

### 4. EAN i kod magazynowy (SKU)
- SKU kopiowany do `external.id` w payloadzie Allegro
- SKU widoczny w formularzu i liście ofert
- Filtrowanie po SKU w zakładce Oferty

### 5. Modyfikator cen
- Reguły marż per konto (tabela `margin_rules`) — ustawialne w %, np. MAN +5%, RAD +6%
- Ręczne nadpisanie ceny per (produkt × konto) z priorytetem nad regułą procentową
- W widoku produktu widoczne 3 ceny obok siebie: **SKLEP – MAN – RAD**
- Przycisk Edytuj / Zapisz / Reset dla każdej ceny

### 6. Warunki oferty
- Wybór stanu: NOWE / UŻYWANE (`condition`) w formularzu
- Stałe ustawienia: "kup teraz", "wysyłka z Polski"

### 7. Wyszukiwarka i filtry w zakładce Oferty
- Filtr po statusie (draft / oczekujące / aktywne / zakończone / błędy)
- Filtr po koncie Allegro (dropdown)
- Filtr po Allegro ID (wyszukiwanie tekstowe z debounce)
- Filtr po SKU / ID produktu (wyszukiwanie tekstowe z debounce)
- Widok kont i statusów per konto w każdym wierszu tabeli

### 8. Panel Konta/Marże w produkcie
- Widoczne statusy oferty per konto z linkami "Edytuj na Allegro" i "Zobacz aukcję"
- Auto-odświeżanie po wystawieniu (polling ~24s)
- Ręczne odświeżanie z synchronizacją live z Allegro API

---

## CZĘŚCIOWO ZROBIONE

### 1. Zaznaczanie i akcje hurtowe
- **Zrobione:** lista produktów, przejście do wystawiania pojedynczo
- **Brakuje:** checkboxy na liście produktów + akcja "Wystaw zaznaczone na konto MAN / RAD" dla wielu ofert naraz

### 2. Oznaczenia na liście produktów
- **Zrobione:** w zakładce Oferty widoczne statusy per konto
- **Brakuje:** na głównej liście produktów (`/products`) brakuje widocznych "kropek" pokazujących czy produkt jest wystawiony na MAN / RAD — widać tylko cenę Allegro MAN

### 3. Tytuły ofert
- **Zrobione:** AI generuje tytuł dostosowany do limitu znaków Allegro
- **Brakuje:** automatyczna lekka wariacja tytułu dla konta RAD (przestawienie członu) żeby Allegro nie wykrywało klonów

### 4. Faktury i SMART
- **Zrobione:** formularz wysyła ofertę do Allegro
- **Brakuje:** pole wyboru per oferta: faktura VAT 23% / VAT-marża; checkbox czy oferta ma być objęta SMART

### 5. Wyszukiwarka po atrybutach produktu
- **Zrobione:** filtr po SKU i statusie wystawienia
- **Brakuje:** filtry po: producencie, sezonie (lato/zima/wielosezon), rozmiarze opony, ilości sztuk w zestawie (1/2/4), wystawione na MAN / na RAD osobno

---

## DO ZROBIENIA

### 4. Automat ponownego wystawiania (re-listing co 14 dni)
Zakończ ofertę i wystaw od nowa co N dni — żeby być wyżej w wynikach Allegro.
- Konfigurowalne: co ile dni (domyślnie 14)
- Przycisk włącz/wyłącz cały proces
- Zakładka **Zakończone** — oferty zakończone przez automat z datą
- Zakładka **Wznowione** — poprawnie ponownie wystawione
- Zakładka **Kolejka / Błędy** — oferty które nie dały się wznowić + kod błędu
- Przetwarzanie partiami (np. 10 szt./min) żeby nie przeciążać API

### 5. Synchronizacja stanów magazynowych i usuwanie po sprzedaży
- Webhook Allegro `BoughtOfferEvent` — gdy ktoś kupi, usuń/zakończ ofertę na drugim koncie Allegro
- Sygnał do starego sklepu: zmniejsz stan magazynowy o 1 (lub ustaw na 0)
- Cykliczny cron (np. co 30 min) porównujący stany między starym sklepem a panelem
- Nowe produkty dodane w starym sklepie zasysane automatycznie do panelu

### 6. Zaznaczanie hurtowe i akcje na wielu ofertach
- Checkboxy na liście produktów
- Przycisk "Wystaw zaznaczone → MAN" / "Wystaw zaznaczone → RAD"
- Opcjonalnie: zaznacz całą stronę

### 7. Filtry po atrybutach produktu (uzupełnienie punktu 7 spec)
Na liście produktów i ofert:
- Producent
- Sezon (lato / zima / wielosezon)
- Rozmiar opony / średnica felgi
- Ilość sztuk w zestawie (1 / 2 / 4)
- Wystawione na MAN / wystawione na RAD (osobne filtry)

### 8. Wariacja tytułu dla konta RAD
- Przy publikacji na RAD: automatycznie przestaw jeden człon tytułu (do uzgodnienia który)
- Cel: uniknięcie wykrycia klonów przez Allegro

### 9. Faktura i SMART per oferta
- Pole wyboru w formularzu: faktura VAT 23% / VAT-marża
- Checkbox: czy oferta objęta SMART
- Przesyłanie tych wartości w payloadzie do Allegro API

### 10. Oznaczenia na liście produktów (kropki MAN / RAD)
- Na liście `/products` przy każdym produkcie: dwie kropki — jedna dla MAN, jedna dla RAD
- Zielona = wystawiona i aktywna, szara = nie wystawiona, żółta = nieaktywna/zakończona

---

## CO WDROŻYĆ TERAZ (zanim pójdzie na produkcję)

Poniższe rzeczy są wymagane lub krytyczne przed uruchomieniem:

| # | Co | Dlaczego teraz |
|---|---|---|
| 1 | **Migracja DB** — uruchom `POST /api/admin/migrate` po restarcie serwera | Tabela `allegro_offer_accounts` i kolumny `is_default`/`is_active` nie istnieją jeszcze na produkcji |
| 2 | **Marże MAN +5% / RAD +6%** — dodaj przez `/margins` | Specyfikacja podaje konkretne wartości startowe |
| 3 | **Oznaczenia MAN/RAD na liście `/products`** | Bez tego operator nie widzi co jest już wystawione bez wchodzenia w każdy produkt |
| 4 | **Faktura VAT 23% / VAT-marża** w formularzu | Klient wprost wymienia to jako pole które musi być wybieralne przed wystawieniem |
| 5 | **Checkbox SMART** w formularzu | Jak wyżej — wymienione jako obowiązkowe do wyboru per oferta |
| 6 | **Hurtowe zaznaczanie + publish** | Bez tego wystawianie dużej ilości produktów będzie bardzo uciążliwe |
