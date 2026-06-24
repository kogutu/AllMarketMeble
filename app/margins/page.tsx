'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const CategoryTreePicker = dynamic(() => import('@/components/margins/CategoryTreePicker'), { ssr: false });

interface MarginRule {
  id: number;
  account_id: string;
  category_source: 'all' | 'typesense' | 'allegro';
  category_id: string;
  category_name: string | null;
  margin_pct: number;
}

interface AllegroAccount {
  account_id: string;
  account_name: string;
}

const TYPESENSE_KINDS = [
  { id: 'biurka', label: 'Biurka' },
  { id: 'krzesla', label: 'Krzesła' },
  { id: 'stoly', label: 'Stoły' },
  { id: 'szafy', label: 'Szafy' },
  { id: 'regaly', label: 'Regały' },
];

const ALL_ACCOUNTS_ID = '__all__';

interface AddRuleFormProps {
  accounts: AllegroAccount[];
  onSaved: () => void;
  onCancel: () => void;
}

function AddRuleForm({ accounts, onSaved, onCancel }: AddRuleFormProps) {
  const [accountId, setAccountId] = useState(ALL_ACCOUNTS_ID);
  const [source, setSource] = useState<'all' | 'typesense' | 'allegro'>('all');
  const [tsKind, setTsKind] = useState('biurka');
  const [tsCustom, setTsCustom] = useState('');
  const [allegroSelected, setAllegroSelected] = useState<{ id: string; name: string }[]>([]);
  const [marginPct, setMarginPct] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const pct = parseFloat(marginPct);
    if (isNaN(pct) || pct < 0) { setError('Podaj prawidłową wartość marży'); return; }

    const rows: { category_source: string; category_id: string; category_name: string | null }[] = [];
    if (source === 'all') {
      rows.push({ category_source: 'all', category_id: 'all', category_name: null });
    } else if (source === 'typesense') {
      const kind = tsKind === '__custom' ? tsCustom.trim() : tsKind;
      if (!kind) { setError('Podaj wartość rodzaju'); return; }
      rows.push({ category_source: 'typesense', category_id: kind, category_name: TYPESENSE_KINDS.find((k) => k.id === kind)?.label || kind });
    } else {
      for (const cat of allegroSelected) {
        rows.push({ category_source: 'allegro', category_id: cat.id, category_name: cat.name });
      }
    }
    if (rows.length === 0) { setError('Wybierz co najmniej jedną kategorię'); return; }

    setSaving(true); setError('');
    try {
      for (const row of rows) {
        const res = await fetch('/api/margins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: accountId, margin_pct: pct, ...row }),
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Błąd zapisu'); }
      }
      onSaved();
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };

  return (
    <div className="card p-5 border-allegro/30 border-2 space-y-4">
      <h3 className="font-semibold text-sm text-gray-700">Nowa reguła marży</h3>

      <div className="grid grid-cols-2 gap-4">
        {/* Account */}
        <div>
          <label className="label">Konto Allegro</label>
          <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value={ALL_ACCOUNTS_ID}>Wszystkie konta (domyślna)</option>
            {accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.account_name}</option>)}
          </select>
          {accountId === ALL_ACCOUNTS_ID && (
            <p className="text-xs text-gray-400 mt-1">Działa jako fallback gdy brak reguły dla konkretnego konta.</p>
          )}
        </div>

        {/* Margin % */}
        <div>
          <label className="label">Marża %</label>
          <div className="relative">
            <input className="input pr-8" type="number" step="0.5" min="0" max="500"
              value={marginPct} onChange={(e) => setMarginPct(e.target.value)} placeholder="np. 5" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
          </div>
        </div>
      </div>

      {/* Category source */}
      <div>
        <label className="label">Kategoria</label>
        <div className="flex gap-4 mt-1">
          {(['all', 'typesense', 'allegro'] as const).map((s) => (
            <label key={s} className="flex items-center gap-1.5 cursor-pointer text-sm">
              <input type="radio" checked={source === s} onChange={() => setSource(s)} className="accent-allegro" />
              {s === 'all' ? 'Wszystkie produkty' : s === 'typesense' ? 'Typesense (rodzaj)' : 'Allegro (drzewo)'}
            </label>
          ))}
        </div>
      </div>

      {source === 'typesense' && (
        <div>
          <label className="label">Rodzaj produktu</label>
          <select className="input" value={tsKind} onChange={(e) => setTsKind(e.target.value)}>
            {TYPESENSE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            <option value="__custom">Własna wartość...</option>
          </select>
          {tsKind === '__custom' && (
            <input className="input mt-2" placeholder="Wpisz wartość pola kind" value={tsCustom}
              onChange={(e) => setTsCustom(e.target.value)} />
          )}
        </div>
      )}

      {source === 'allegro' && (
        <div>
          <label className="label">Kategorie Allegro (zaznacz checkboxem)</label>
          <CategoryTreePicker selected={allegroSelected} onChange={setAllegroSelected} />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-ghost btn-sm">Anuluj</button>
        <button onClick={save} disabled={saving || !marginPct} className="btn-primary btn-sm">
          {saving ? 'Zapisywanie...' : 'Zapisz'}
        </button>
      </div>
    </div>
  );
}

function EditInline({ rule, onSaved, onCancel }: { rule: MarginRule; onSaved: () => void; onCancel: () => void }) {
  const [val, setVal] = useState(String(rule.margin_pct));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    await fetch(`/api/margins/${rule.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ margin_pct: parseFloat(val), category_name: rule.category_name }) });
    setSaving(false); onSaved();
  };
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-24">
        <input className="input pr-7 text-sm py-1" type="number" step="0.5" min="0" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">%</span>
      </div>
      <button onClick={save} disabled={saving} className="btn-primary btn-sm text-xs">{saving ? '...' : 'OK'}</button>
      <button onClick={onCancel} className="btn-ghost btn-sm text-xs">✕</button>
    </div>
  );
}

export default function MarginsPage() {
  const [rules, setRules] = useState<MarginRule[]>([]);
  const [accounts, setAccounts] = useState<AllegroAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetch('/api/margins').then((r) => r.json()).then((d) => setRules(d.rules || [])).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    fetch('/api/allegro/accounts').then((r) => r.json()).then((d) => setAccounts(d.accounts || [])).catch(() => {});
  }, []);

  const remove = async (id: number) => {
    if (!confirm('Usunąć tę regułę?')) return;
    await fetch(`/api/margins/${id}`, { method: 'DELETE' });
    load();
  };

  const accountLabel = (accountId: string) => {
    if (accountId === ALL_ACCOUNTS_ID) return <span className="badge bg-gray-100 text-gray-600">Wszystkie konta</span>;
    const acc = accounts.find((a) => a.account_id === accountId);
    return <span className="badge bg-allegro/10 text-allegro">{acc?.account_name || accountId}</span>;
  };

  // Group: __all__ first, then per account
  const globalRules = rules.filter((r) => r.account_id === ALL_ACCOUNTS_ID);
  const accountGroups = accounts.map((acc) => ({
    acc,
    rules: rules.filter((r) => r.account_id === acc.account_id),
  }));

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reguły marży</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Marże per konto Allegro, opcjonalnie per kategoria. Reguły &quot;Wszystkie konta&quot; działają jako fallback.
          </p>
        </div>
        {!adding && <button onClick={() => setAdding(true)} className="btn-primary btn-sm">+ Dodaj regułę</button>}
      </div>

      {adding && (
        <AddRuleForm accounts={accounts} onSaved={() => { load(); setAdding(false); }} onCancel={() => setAdding(false)} />
      )}

      {loading ? (
        <div className="card p-8 text-center text-gray-400">Ładowanie...</div>
      ) : rules.length === 0 ? (
        <div className="card p-8 text-center text-gray-400">
          Brak reguł. <button onClick={() => setAdding(true)} className="text-allegro hover:underline">Dodaj pierwszą</button>.
        </div>
      ) : (
        <>
          {/* Global (all accounts) rules */}
          {globalRules.length > 0 && (
            <RulesTable
              title="Wszystkie konta (fallback)"
              titleBadge={<span className="badge bg-gray-100 text-gray-500 text-xs">Fallback</span>}
              rules={globalRules}
              accountLabel={accountLabel}
              editingId={editingId}
              setEditingId={setEditingId}
              onRemove={remove}
              onReload={load}
            />
          )}

          {/* Per-account rules */}
          {accountGroups.filter((g) => g.rules.length > 0).map(({ acc, rules: accRules }) => (
            <RulesTable
              key={acc.account_id}
              title={acc.account_name}
              titleBadge={<span className="badge bg-allegro/10 text-allegro text-xs">{acc.account_id}</span>}
              rules={accRules}
              accountLabel={accountLabel}
              editingId={editingId}
              setEditingId={setEditingId}
              onRemove={remove}
              onReload={load}
            />
          ))}
        </>
      )}

      <div className="card p-4 bg-blue-50 border-blue-100 text-xs text-blue-700 space-y-1">
        <p className="font-semibold">Priorytety:</p>
        <p>Reguła konta &gt; Reguła &quot;Wszystkie konta&quot;. W obu przypadkach: kategoria Allegro &gt; rodzaj Typesense &gt; wszystkie produkty. Ręczna cena w produkcie ma zawsze pierwszeństwo.</p>
      </div>
    </div>
  );
}

function RulesTable({ title, titleBadge, rules, accountLabel, editingId, setEditingId, onRemove, onReload }: {
  title: string;
  titleBadge: React.ReactNode;
  rules: MarginRule[];
  accountLabel: (id: string) => React.ReactNode;
  editingId: number | null;
  setEditingId: (id: number | null) => void;
  onRemove: (id: number) => void;
  onReload: () => void;
}) {
  void accountLabel;
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
        <h3 className="font-semibold text-sm text-gray-700">{title}</h3>
        {titleBadge}
        <span className="text-gray-400 font-normal text-xs">({rules.length} reguł)</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="px-4 py-2.5 text-left font-medium text-gray-600">Kategoria</th>
            <th className="px-4 py-2.5 text-right font-medium text-gray-600">Marża</th>
            <th className="px-4 py-2.5 text-right font-medium text-gray-600">Przykład (100 zł)</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                    rule.category_source === 'all' ? 'bg-gray-400' :
                    rule.category_source === 'typesense' ? 'bg-blue-500' : 'bg-orange-500'
                  }`} />
                  {categoryLabel(rule)}
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                {editingId === rule.id ? (
                  <EditInline rule={rule} onSaved={() => { onReload(); setEditingId(null); }} onCancel={() => setEditingId(null)} />
                ) : (
                  <span
                    className="inline-flex items-center bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-mono text-xs font-semibold cursor-pointer hover:bg-green-100"
                    onClick={() => setEditingId(rule.id)}
                  >
                    +{Number(rule.margin_pct).toFixed(1)}%
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right text-xs text-gray-500">
                <span className="font-semibold text-gray-800">{(100 * (1 + Number(rule.margin_pct) / 100)).toFixed(2)} zł</span>
              </td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => onRemove(rule.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">Usuń</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function categoryLabel(rule: MarginRule): string {
  if (rule.category_source === 'all') return 'Wszystkie produkty';
  if (rule.category_source === 'typesense') {
    const k = TYPESENSE_KINDS.find((k) => k.id === rule.category_id);
    return `Typesense: ${k?.label || rule.category_id}`;
  }
  return `Allegro: ${rule.category_name || rule.category_id}`;
}
