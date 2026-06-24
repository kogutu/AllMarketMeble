'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/products': 'Produkty',
  '/offers': 'Oferty Allegro',
  '/accounts': 'Konta Allegro',
  '/margins': 'Marże',
};

interface Account {
  account_id: string;
  account_name: string;
}

interface AccountInfo {
  login: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: { name?: string; taxId?: string };
  activeOffers: number;
  totalOffers: number;
  endedOffers: number;
}

function AccountPopover({ account, color }: { account: Account; color: string }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchedRef = useRef(false);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      setLoading(true);
      setError(null);
      fetch(`/api/allegro/account-info?accountId=${encodeURIComponent(account.account_id)}`)
        .then((r) => r.json())
        .then((d: AccountInfo & { error?: string }) => {
          if (d.error) { setError(d.error); return; }
          setInfo(d);
        })
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    }
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 200);
  };

  const inactiveOffers = info ? info.totalOffers - info.activeOffers - info.endedOffers : 0;

  return (
    <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <Link
        href="/accounts"
        className="relative flex items-center justify-center w-8 h-8 rounded-full text-white text-sm font-bold transition-opacity hover:opacity-80"
        style={{ backgroundColor: color }}
      >
        {account.account_name.charAt(0).toUpperCase()}
      </Link>

      {open && (
        <div
          className="absolute right-0 top-10 z-50 w-72 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden"
          onMouseEnter={() => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }}
          onMouseLeave={handleMouseLeave}
        >
          {/* Header */}
          <div className="px-4 py-3 flex items-center gap-3" style={{ backgroundColor: color + '18' }}>
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white text-base font-bold shrink-0"
              style={{ backgroundColor: color }}
            >
              {account.account_name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-gray-900 truncate">{account.account_name}</p>
              {info?.login && <p className="text-xs text-gray-500 truncate">@{info.login}</p>}
              {info?.email && <p className="text-xs text-gray-400 truncate">{info.email}</p>}
            </div>
          </div>

          {loading && (
            <div className="px-4 py-5 flex items-center justify-center gap-2 text-sm text-gray-400">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Pobieranie danych z Allegro...
            </div>
          )}

          {error && (
            <div className="px-4 py-3 text-xs text-red-500">{error}</div>
          )}

          {info && !loading && (
            <>
              {info.company?.name && (
                <div className="px-4 pt-3 pb-1">
                  <p className="text-xs text-gray-400">Firma</p>
                  <p className="text-sm font-medium text-gray-800">{info.company.name}</p>
                  {info.company.taxId && <p className="text-xs text-gray-400">NIP: {info.company.taxId}</p>}
                </div>
              )}

              <div className="px-4 py-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-green-50 border border-green-100 p-2 text-center">
                  <p className="text-lg font-bold text-green-700">{info.activeOffers.toLocaleString('pl')}</p>
                  <p className="text-xs text-green-600 leading-tight">Aktywne</p>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-2 text-center">
                  <p className="text-lg font-bold text-gray-600">{inactiveOffers > 0 ? inactiveOffers.toLocaleString('pl') : '—'}</p>
                  <p className="text-xs text-gray-400 leading-tight">Nieaktywne</p>
                </div>
                <div className="rounded-lg bg-orange-50 border border-orange-100 p-2 text-center">
                  <p className="text-lg font-bold text-orange-600">{info.endedOffers.toLocaleString('pl')}</p>
                  <p className="text-xs text-orange-500 leading-tight">Zakończone</p>
                </div>
              </div>

              <div className="px-4 pb-3 text-center">
                <p className="text-xs text-gray-400">Łącznie ofert: <span className="font-semibold text-gray-600">{info.totalOffers.toLocaleString('pl')}</span></p>
              </div>
            </>
          )}

          <div className="border-t border-gray-100 px-4 py-2 flex justify-between items-center">
            <Link href="/accounts" className="text-xs text-allegro hover:underline">Zarządzaj kontem</Link>
            <Link href="/offers" className="text-xs text-gray-400 hover:text-gray-600 hover:underline">Oferty →</Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TopBar() {
  const pathname = usePathname();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [verifying, setVerifying] = useState(false);

  const title = Object.entries(titles).find(([key]) =>
    key === '/' ? pathname === '/' : pathname.startsWith(key)
  )?.[1] || 'Panel';

  useEffect(() => {
    fetch('/api/allegro/accounts')
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (accounts.length === 0) return;
    setVerifying(true);
    fetch('/api/allegro/accounts/verify')
      .then((r) => r.json())
      .then((d) => setVerified(d.verified || {}))
      .catch(() => {})
      .finally(() => setVerifying(false));
  }, [accounts]);

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
      <h1 className="text-lg font-semibold text-gray-900">{title}</h1>

      <div className="flex items-center gap-2">
        {accounts.length === 0 && !verifying && (
          <Link href="/accounts" className="btn-primary btn text-xs px-3 py-1.5">
            Połącz konto Allegro
          </Link>
        )}
        {accounts.map((acc) => {
          const isOk = verified[acc.account_id];
          const isDetermined = acc.account_id in verified;
          const color = stringToColor(acc.account_name);
          return (
            <div key={acc.account_id} className="relative">
              <AccountPopover account={acc} color={color} />
              {/* Status dot outside the popover wrapper so it doesn't interfere */}
              <span
                className={`pointer-events-none absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                  !isDetermined ? 'bg-gray-300 animate-pulse' :
                  isOk ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
            </div>
          );
        })}
      </div>
    </header>
  );
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6'];
  return colors[Math.abs(hash) % colors.length];
}
