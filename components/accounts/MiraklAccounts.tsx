'use client';

import { useState, useEffect } from 'react';

interface Operator { id: string; name: string; }
interface MiraklAccount {
  account_id: string;
  account_name: string;
  operator: string | null;
  base_url: string | null;
  is_active: number;
  created_at: string;
}

export default function MiraklAccounts() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [accounts, setAccounts] = useState<MiraklAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [operator, setOperator] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch('/api/mirakl/accounts')
      .then((r) => r.json())
      .then((d) => {
        setOperators(d.operators || []);
        setAccounts(d.accounts || []);
        setWarning(d.warning || null);
        if (!operator && d.operators?.[0]) setOperator(d.operators[0].id);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleSave = async () => {
    if (!operator) return;
    setSaving(true);
    try {
      await fetch('/api/mirakl/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operator,
          accountId: accountId.trim() || operator,
          accountName: accountName.trim() || operator,
          apiKey: apiKey.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
        }),
      });
      setAccountId(''); setAccountName(''); setApiKey(''); setBaseUrl('');
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (acc: MiraklAccount) => {
    if (!confirm(`Odłączyć konto "${acc.account_name}"?`)) return;
    await fetch(`/api/mirakl/accounts?accountId=${encodeURIComponent(acc.account_id)}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Konta Mirakl (Empik)</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Sklepy na platformie Mirakl (Empik i kolejne). Autoryzacja przez klucz API sklepu.
        </p>
      </div>

      {warning && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm">
          {warning}
        </div>
      )}

      {/* Add account */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-sm text-gray-700">Dodaj / zaktualizuj konto</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Operator</label>
            <select className="input" value={operator} onChange={(e) => setOperator(e.target.value)}>
              {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Identyfikator konta</label>
            <input className="input" value={accountId}
              onChange={(e) => setAccountId(e.target.value.replace(/\s/g, '-').toLowerCase())}
              placeholder={operator || 'np. empik'} />
          </div>
          <div>
            <label className="label">Nazwa wyświetlana</label>
            <input className="input" value={accountName}
              onChange={(e) => setAccountName(e.target.value)} placeholder="np. Empik" />
          </div>
          <div>
            <label className="label">Klucz API (opcjonalny — domyślnie z env)</label>
            <input className="input font-mono text-xs" value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} placeholder="pozostaw puste, by użyć .env" />
          </div>
          <div className="col-span-2">
            <label className="label">Base URL (opcjonalny)</label>
            <input className="input font-mono text-xs" value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)} placeholder="np. https://empik.mirakl.net" />
          </div>
        </div>
        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving || !operator} className="btn-primary btn-sm">
            {saving ? 'Zapisywanie…' : 'Zapisz konto'}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="font-semibold text-sm text-gray-700">Połączone konta Mirakl ({accounts.length})</h3>
          <button onClick={load} className="text-xs text-gray-400 hover:text-gray-600">Odśwież</button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400">Ładowanie...</div>
        ) : accounts.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Brak połączonych kont Mirakl.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {accounts.map((acc) => (
              <li key={acc.account_id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm shrink-0">
                  {acc.account_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-gray-900">{acc.account_name}</p>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">
                    {acc.account_id} · {acc.operator}{acc.base_url ? ` · ${acc.base_url}` : ''}
                  </p>
                </div>
                <button onClick={() => handleDelete(acc)}
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">
                  Odłącz
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
