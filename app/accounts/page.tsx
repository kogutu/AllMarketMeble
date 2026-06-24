'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import MiraklAccounts from '@/components/accounts/MiraklAccounts';

interface AllegroAccount {
  account_id: string;
  account_name: string;
  expires_at: string;
  created_at: string;
  is_default: number;
  is_active: number;
}

function AccountsContent() {
  const searchParams = useSearchParams();
  const successName = searchParams.get('allegro_success');
  const errorMsg = searchParams.get('allegro_error');

  const [accounts, setAccounts] = useState<AllegroAccount[]>([]);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [authUrl, setAuthUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const load = () => {
    setLoading(true);
    fetch('/api/allegro/accounts')
      .then((r) => r.json())
      .then((d) => {
        const list: AllegroAccount[] = d.accounts || [];
        setAccounts(list);
        if (list.length > 0) {
          setVerifying(true);
          fetch('/api/allegro/accounts/verify')
            .then((r) => r.json())
            .then((vd) => setVerified(vd.verified || {}))
            .catch(() => { })
            .finally(() => setVerifying(false));
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const patch = async (accountId: string, body: Record<string, unknown>) => {
    await fetch(`/api/allegro/accounts/${encodeURIComponent(accountId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    load();
  };

  const handleGenerate = async () => {
    if (!newId.trim() || !newName.trim()) return;
    setGenerating(true);
    setAuthUrl('');
    try {
      const res = await fetch(
        `/api/allegro/auth?accountId=${encodeURIComponent(newId.trim())}&accountName=${encodeURIComponent(newName.trim())}`
      );
      const data = await res.json();
      if (data.authUrl) setAuthUrl(data.authUrl as string);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(authUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDelete = async (accountId: string, accountName: string) => {
    if (!confirm(`Odłączyć konto "${accountName}"?`)) return;
    await fetch(`/api/allegro/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    load();
  };

  const handleSaveName = async (accountId: string) => {
    if (!editName.trim()) return;
    await patch(accountId, { account_name: editName });
    setEditingId(null);
  };

  const statusLabel = (acc: AllegroAccount) => {
    if (!acc.is_active) return 'Wyłączone';
    if (!(acc.account_id in verified)) return verifying ? 'Weryfikacja…' : 'Nieznany';
    return verified[acc.account_id] ? 'Aktywne' : 'Nieaktywne';
  };

  const statusColor = (acc: AllegroAccount) => {
    if (!acc.is_active) return 'bg-gray-100 text-gray-500';
    if (!(acc.account_id in verified)) return 'bg-gray-100 text-gray-400';
    return verified[acc.account_id] ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600';
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Konta Allegro</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Połącz wiele kont Allegro. Przy wystawianiu oferty wybierasz na które konto ma trafić.
        </p>
      </div>

      {successName && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm">
          Konto <strong>{successName}</strong> zostało pomyślnie połączone.
        </div>
      )}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          Błąd autoryzacji: {errorMsg}
        </div>
      )}

      {/* Add new account */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-sm text-gray-700">Dodaj nowe konto</h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Identyfikator (unikalny)</label>
            <input
              className="input"
              value={newId}
              onChange={(e) => { setNewId(e.target.value.replace(/\s/g, '-').toLowerCase()); setAuthUrl(''); }}
              placeholder="np. konto-drugie"
            />
          </div>
          <div>
            <label className="label">Nazwa wyświetlana</label>
            <input
              className="input"
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setAuthUrl(''); }}
              placeholder="np. Konto drugie"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleGenerate}
            disabled={generating || !newId.trim() || !newName.trim()}
            className="btn-primary btn-sm"
          >
            {generating ? 'Generowanie...' : 'Generuj URL autoryzacji'}
          </button>
        </div>

        {authUrl && (
          <div className="space-y-3 pt-1 border-t border-gray-100">
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">Jak podłączyć nowe konto:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Skopiuj URL poniżej przyciskiem <strong>Kopiuj</strong></li>
                <li>Otwórz <strong>tryb incognito</strong> (Ctrl+Shift+N) i wklej URL</li>
                <li>Zaloguj się na docelowe konto Allegro i zatwierdź uprawnienia</li>
                <li>Token zostanie automatycznie zapisany — wróć tu i kliknij <strong>Odśwież</strong></li>
              </ol>
            </div>
            <div className="flex gap-2 items-center">
              <input
                readOnly
                value={authUrl}
                className="input font-mono text-xs flex-1 bg-gray-50 text-gray-600 select-all"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button onClick={handleCopy} className="btn-secondary btn-sm shrink-0 w-20">
                {copied ? '✓ Skopiowano' : 'Kopiuj'}
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={load} className="btn-secondary btn-sm">Odśwież listę kont</button>
            </div>
          </div>
        )}
      </div>

      {/* Accounts list */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="font-semibold text-sm text-gray-700">Połączone konta ({accounts.length})</h3>
          <button onClick={load} className="text-xs text-gray-400 hover:text-gray-600">Odśwież</button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400">Ładowanie...</div>
        ) : accounts.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Brak połączonych kont.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {accounts.map((acc) => (
              <li key={acc.account_id} className={`px-4 py-3 ${!acc.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-allegro/10 text-allegro flex items-center justify-center font-bold text-sm shrink-0">
                    {acc.account_name.charAt(0).toUpperCase()}
                  </div>

                  {/* Name / edit */}
                  <div className="flex-1 min-w-0">
                    {editingId === acc.account_id ? (
                      <div className="flex gap-2 items-center">
                        <input
                          className="input py-1 text-sm flex-1"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(acc.account_id); if (e.key === 'Escape') setEditingId(null); }}
                          autoFocus
                        />
                        <button onClick={() => handleSaveName(acc.account_id)} className="btn-primary btn-sm py-1">Zapisz</button>
                        <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm text-gray-900">{acc.account_name}</p>
                        {!!acc.is_default && (
                          <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-medium">★ domyślne</span>
                        )}
                        <button
                          onClick={() => { setEditingId(acc.account_id); setEditName(acc.account_name); }}
                          className="text-gray-300 hover:text-gray-600 text-xs"
                          title="Edytuj nazwę"
                        >
                          ✎
                        </button>
                      </div>
                    )}
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{acc.account_id}</p>
                  </div>

                  {/* Status badge */}
                  <div className="text-right shrink-0">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(acc)}`}>
                      {verifying && !(acc.account_id in verified) && acc.is_active ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse inline-block" />
                      ) : null}
                      {statusLabel(acc)}
                    </span>
                    <p className="text-xs text-gray-400 mt-0.5">wygasa {new Date(acc.expires_at).toLocaleDateString('pl')}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1 shrink-0 items-center">
                    {/* Toggle active */}
                    <button
                      onClick={() => patch(acc.account_id, { is_active: !acc.is_active })}
                      title={acc.is_active ? 'Wyłącz konto' : 'Włącz konto'}
                      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${acc.is_active ? 'bg-green-400' : 'bg-gray-200'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${acc.is_active ? 'translate-x-0' : '-translate-x-4'}`} />
                    </button>

                    {/* Set default */}
                    {!acc.is_default && (
                      <button
                        onClick={() => patch(acc.account_id, { setDefault: true })}
                        className="text-xs text-gray-400 hover:text-amber-600 px-2 py-1 rounded hover:bg-amber-50"
                        title="Ustaw jako domyślne"
                      >
                        ★
                      </button>
                    )}

                    {/* Renew */}
                    <button
                      onClick={() => { setNewId(acc.account_id); setNewName(acc.account_name); setAuthUrl(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      className="text-xs text-allegro hover:underline px-2 py-1 rounded hover:bg-allegro/5"
                    >
                      Odnów
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(acc.account_id, acc.account_name)}
                      className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50"
                    >
                      Odłącz
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Mirakl (Empik) accounts */}
      <div className="pt-8 mt-8 border-t border-gray-200">
        <MiraklAccounts />
      </div>
    </div>
  );
}

export default function AccountsPage() {
  return (
    <Suspense>
      <AccountsContent />
    </Suspense>
  );
}
