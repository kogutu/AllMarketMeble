import Link from 'next/link';

async function getStats() {
  alert("PAMIETAJ .ENV - zmienic\nGDY PORT SIE ZMIENII ⚠️")
  // We can't call our own API server-side before it's running, so we'll do client-side
  return null;
}

export default function Dashboard() {


  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Witaj w panelu Allegro</h2>
        <p className="text-gray-500 mt-1">
          Przeglądaj produkty z Typesense i wystawiaj oferty na Allegro z pomocą AI.
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Link
          href="/products"
          className="card p-6 hover:border-allegro transition-colors group"
        >
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-allegro/10 rounded-xl flex items-center justify-center text-allegro group-hover:bg-allegro group-hover:text-white transition-colors">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Produkty </h3>
              <p className="text-sm text-gray-500 mt-1">
                Przeglądaj meble. Dodaj produkt do Allegro lub Empik jednym kliknięciem.
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/offers"
          className="card p-6 hover:border-allegro transition-colors group"
        >
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center text-orange-500 group-hover:bg-orange-500 group-hover:text-white transition-colors">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Oferty Allegro</h3>
              <p className="text-sm text-gray-500 mt-1">
                Zarządzaj draftem i aktywnymi ofertami. Śledź statusy i ID aukcji.
              </p>
            </div>
          </div>
        </Link>
      </div>

      {/* Feature list */}
      <div className="card p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Jak to działa?</h3>
        <ol className="space-y-3">
          {[
            {
              n: '1',
              title: 'Wybierz produkt',
              desc: 'Wyszukaj mebel w bazie (biurka, krzesła, stoły, szafy...).',
            },
            {
              n: '2',
              title: 'Wypełnij formularz',
              desc: 'Kliknij „Wypełnij przez AI" — ChatGPT automatycznie uzupełni pola na podstawie danych produktu.',
            },
            {
              n: '3',
              title: 'Wygeneruj opis',
              desc: 'Kliknij „Generuj opis" — ChatGPT napisze profesjonalny opis aukcji po polsku.',
            },
            {
              n: '4',
              title: 'Zwaliduj',
              desc: 'Kliknij „Waliduj" — AI sprawdzi kompletność i poprawność danych przed wysłaniem.',
            },
            {
              n: '5',
              title: 'Wyślij na Allegro',
              desc: 'Po pozytywnej walidacji wyślij ofertę. ID aukcji zostanie zapisane w bazie.',
            },
          ].map((step) => (
            <li key={step.n} className="flex gap-4">
              <span className="w-7 h-7 rounded-full bg-allegro text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                {step.n}
              </span>
              <div>
                <span className="font-medium text-gray-900">{step.title}</span>
                <span className="text-gray-500"> — {step.desc}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
