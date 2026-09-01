import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/instructions          → { content: string }
 * PUT  /api/instructions  { content } → { ok: true }
 * Treść instrukcji przechowywana jako HTML w tabeli page_content.
 */

async function ensureTable() {
  await query(`CREATE TABLE IF NOT EXISTS page_content (
    id    INT AUTO_INCREMENT PRIMARY KEY,
    slug  VARCHAR(100) NOT NULL UNIQUE,
    html  MEDIUMTEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
}

const DEFAULT_HTML = `
<h1>Instrukcja obsługi panelu Mebel-Partner</h1>

<h2>1. Produkty</h2>
<p>Strona <strong>Produkty</strong> zawiera pełny katalog produktów zsynchronizowany z Typesense. Możesz tu przeglądać, filtrować i wyszukiwać produkty, a następnie wystawiać je na wybranych marketplace'ach.</p>
<ul>
  <li><strong>Wyszukiwarka</strong> — wpisz nazwę, SKU lub EAN produktu</li>
  <li><strong>Filtr kategorii</strong> — zawęź listę do wybranej kategorii mebli</li>
  <li><strong>Filtry marketplace</strong> — pokaż produkty wystawione/niewystawione na danej platformie</li>
  <li><strong>Kolorowe kropki</strong> — zielona = aktywna oferta, żółta = oczekuje/w toku, szara = brak oferty</li>
</ul>

<h2>2. Produkty (tabela)</h2>
<p>Alternatywny widok katalogowy w formie tabeli AG Grid. Umożliwia filtrowanie po kolumnach, sortowanie i masowe działania.</p>
<ul>
  <li>Kliknij kolorową kropkę marketplace → przechodzi do formularza wystawiania</li>
  <li>Zaznacz wiersze i użyj funkcji <strong>Bulk add</strong> aby dodać wiele produktów naraz</li>
</ul>

<h2>3. Wystawianie na Allegro</h2>
<p>Wejdź w produkt → <em>Dodaj do Allegro</em>. Formularz oferuje:</p>
<ul>
  <li><strong>AI Wypełnij</strong> — automatyczne wypełnienie parametrów kategorii przez AI</li>
  <li><strong>AI Opis</strong> — generowanie opisu produktu</li>
  <li><strong>Kategoria</strong> — drzewo kategorii Allegro z wyszukiwarką</li>
  <li><strong>Parametry</strong> — pola wymagane przez Allegro (kolor, materiał, wymiary itp.)</li>
  <li><strong>Opis i zdjęcia</strong> — edytor WYSIWYG, galeria zdjęć</li>
  <li>Po wypełnieniu kliknij <strong>🚀 Wystaw</strong> przy odpowiednim koncie</li>
</ul>

<h2>4. Wystawianie na Empik (Mirakl)</h2>
<p>Wejdź w produkt → <em>Dodaj do Empik</em>:</p>
<ul>
  <li>AI automatycznie dobiera kategorię i wypełnia atrybuty</li>
  <li><strong>STR_GOLD</strong> — kategoria ścieżki Empik (dobierana z mappingu kategorii)</li>
  <li>Zdjęcia wypełniają się automatycznie z galerii produktu</li>
  <li>Kliknij <strong>🚀 Wystaw na Empik</strong> po sprawdzeniu pól</li>
  <li>Status <em>Oczekuje</em> = import wysłany, Empik przetwarza (kilka minut–godzin)</li>
</ul>

<h2>5. Wystawianie na BRW (Black Red White)</h2>
<p>Analogicznie jak Empik — wejdź w produkt → <em>Dodaj do BRW</em>:</p>
<ul>
  <li>Pola <strong>Producent</strong>, <strong>Marka</strong>, <strong>Kraj pochodzenia</strong> wypełniają się automatycznie</li>
  <li>AI sugeruje kategorię i wypełnia atrybuty kategorii</li>
  <li>Sprawdź wymagane pola (oznaczone <span style="color:red">*</span>) przed wystawieniem</li>
</ul>

<h2>6. Dodawane (Bulk)</h2>
<p>Strona <strong>Dodawane</strong> to kolejka masowego przetwarzania produktów:</p>
<ul>
  <li>Na stronie Produktów zaznacz wiele produktów → nadaj nazwę listy → kliknij <em>Dodaj do kolejki</em></li>
  <li>System automatycznie: dobiera kategorię (AI) → wypełnia atrybuty (AI) → zapisuje szkic</li>
  <li>Po przetworzeniu status zmienia się na <strong>Gotowe</strong> → kliknij <em>Wystaw</em> lub <em>Wystaw wszystkie</em></li>
  <li>Przy błędzie kliknij <em>↺ Ponów</em> — system przetworzy produkt ponownie przez AI</li>
  <li>Wyszukaj po tytule/EAN lub filtruj po marketplace za pomocą pola i selecta u góry</li>
</ul>

<h2>7. Dodane — status ofert</h2>
<p>Strona <strong>Dodane</strong> w menu pokazuje wszystkie złożone oferty z ich statusem:</p>
<ul>
  <li><strong>Aktywna</strong> — oferta jest widoczna na marketplace</li>
  <li><strong>Oczekuje</strong> — import wysłany, marketplace jeszcze nie potwierdził</li>
  <li><strong>Błąd</strong> — kliknij <em>Pobierz błędy</em> aby zobaczyć szczegóły z Mirakl API</li>
</ul>

<h2>8. Synchronizacja</h2>
<p>Panel synchronizuje dane z marketplace'ami (ceny, stany, statusy):</p>
<ul>
  <li>Synchronizacja uruchamia się automatycznie przez CRON co 2 godziny</li>
  <li>W prawym górnym rogu widoczny przycisk <strong>Sync</strong> — pomarańczowy gdy trwa, szary gdy nie</li>
  <li>Jeśli synchronizacja się zawiesiła (> 10 minut bez postępu) — kliknij <em>Sync</em> → <em>Resetuj</em></li>
  <li>W lewym dolnym rogu wyświetla się pasek postępu aktywnych synchronizacji</li>
</ul>

<h2>9. Marże</h2>
<p>Strona <strong>Marże</strong> pozwala ustawić reguły marżowania per marketplace i kategoria.</p>

<h2>10. Konta Allegro</h2>
<p>Zarządzanie połączonymi kontami Allegro. Tu możesz połączyć nowe konto przez OAuth.</p>

<h2>Wskazówki</h2>
<ul>
  <li>Zawsze sprawdź wymagane pola przed wystawieniem — brakujące pola blokują publikację</li>
  <li>EAN musi być poprawny — jest kluczem do łączenia ofert z produktami w bazie</li>
  <li>Jeśli AI wypełni niepoprawne wartości — zmień ręcznie i zapisz szkic przed wystawieniem</li>
  <li>W razie problemów z Mirakl (BRW/Empik) — sprawdź stronę <em>Dodane</em> i pobierz raport błędów</li>
</ul>
`;

export async function GET() {
  await ensureTable();
  const rows = await query<{ html: string }>('SELECT html FROM page_content WHERE slug = ?', ['instrukcja']);
  return NextResponse.json({ content: rows[0]?.html ?? DEFAULT_HTML });
}

export async function PUT(req: NextRequest) {
  await ensureTable();
  const { content } = await req.json();
  if (typeof content !== 'string') return NextResponse.json({ error: 'content required' }, { status: 400 });
  await query(
    `INSERT INTO page_content (slug, html) VALUES (?, ?) ON DUPLICATE KEY UPDATE html = VALUES(html)`,
    ['instrukcja', content]
  );
  return NextResponse.json({ ok: true });
}
