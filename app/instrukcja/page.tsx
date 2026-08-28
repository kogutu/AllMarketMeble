'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

const TOOLBAR = [
  { label: 'H1', cmd: 'formatBlock', arg: 'h1', cls: 'font-bold text-base' },
  { label: 'H2', cmd: 'formatBlock', arg: 'h2', cls: 'font-bold' },
  { label: 'H3', cmd: 'formatBlock', arg: 'h3' },
  { label: 'P',  cmd: 'formatBlock', arg: 'p' },
  { label: 'B',  cmd: 'bold', cls: 'font-bold' },
  { label: 'I',  cmd: 'italic', cls: 'italic' },
  { label: 'U',  cmd: 'underline', cls: 'underline' },
  { label: '• Lista', cmd: 'insertUnorderedList' },
  { label: '1. Lista', cmd: 'insertOrderedList' },
  { label: '— Linia', cmd: 'insertHorizontalRule' },
];

type Tab = 'ogolne' | 'brw' | 'empik' | 'produkty-tabela';

const TABS: { id: Tab; label: string; pdf?: string }[] = [
  { id: 'ogolne',          label: '📖 Ogólne' },
  { id: 'brw',             label: '🛋 BRW',             pdf: '/instrukcje/BRW.pdf' },
  { id: 'empik',           label: '🛍 Empik',           pdf: '/instrukcje/EMPIK.pdf' },
  { id: 'produkty-tabela', label: '📊 Produkty (tabela)', pdf: '/instrukcje/Produkty-tabela.pdf' },
];

function PdfViewer({ src }: { src: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" style={{ height: 'calc(100vh - 180px)' }}>
      <iframe
        src={src}
        className="w-full h-full"
        title="Instrukcja PDF"
      />
    </div>
  );
}

export default function InstrukcjaPage() {
  const [activeTab, setActiveTab] = useState<Tab>('ogolne');
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef('');

  useEffect(() => {
    fetch('/api/instructions')
      .then((r) => r.json())
      .then((d) => { setContent(d.content || ''); savedRef.current = d.content || ''; })
      .catch(() => toast.error('Błąd wczytywania instrukcji'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (editing && editorRef.current && content) {
      editorRef.current.innerHTML = content;
    }
  }, [editing]);

  const exec = useCallback((cmd: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
  }, []);

  const insertImage = () => {
    const url = prompt('URL zdjęcia (np. https://...):');
    if (!url) return;
    editorRef.current?.focus();
    document.execCommand('insertHTML', false,
      `<figure style="margin:1rem 0"><img src="${url}" alt="" style="max-width:100%;border-radius:8px;border:1px solid #e5e7eb"/><figcaption style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem">Zdjęcie</figcaption></figure>`
    );
  };

  const insertNote = () => {
    editorRef.current?.focus();
    document.execCommand('insertHTML', false,
      `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:0.75rem 1rem;border-radius:0 8px 8px 0;margin:1rem 0"><strong>💡 Wskazówka:</strong> Wpisz treść wskazówki tutaj.</div>`
    );
  };

  const save = async () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    setSaving(true);
    try {
      const res = await fetch('/api/instructions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: html }),
      });
      if (!res.ok) throw new Error();
      setContent(html);
      savedRef.current = html;
      setEditing(false);
      toast.success('Instrukcja zapisana!');
    } catch {
      toast.error('Błąd zapisu instrukcji');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setEditing(false);
    if (editorRef.current) editorRef.current.innerHTML = savedRef.current;
    setContent(savedRef.current);
  };

  const currentTab = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      {/* Nagłówek */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">📖 Instrukcja obsługi</h1>
        {activeTab === 'ogolne' && !loading && (
          <div className="flex gap-2">
            {editing ? (
              <>
                <button onClick={cancel} className="btn-secondary btn-sm">Anuluj</button>
                <button onClick={save} disabled={saving} className="btn-primary btn-sm">
                  {saving ? 'Zapisywanie…' : '💾 Zapisz'}
                </button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} className="btn-secondary btn-sm">
                ✏ Edytuj
              </button>
            )}
          </div>
        )}
        {currentTab.pdf && (
          <a
            href={currentTab.pdf}
            download
            className="btn-secondary btn-sm flex items-center gap-1.5 text-xs"
          >
            ⬇ Pobierz PDF
          </a>
        )}
      </div>

      {/* Zakładki */}
      <div className="flex border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setEditing(false); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Zawartość zakładki PDF */}
      {currentTab.pdf && (
        <PdfViewer src={currentTab.pdf} />
      )}

      {/* Zakładka Ogólne — edytowalny HTML */}
      {activeTab === 'ogolne' && (
        <>
          {loading ? (
            <div className="text-gray-400 animate-pulse p-8">Wczytywanie…</div>
          ) : editing ? (
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="flex flex-wrap gap-0.5 p-2 bg-gray-50 border-b border-gray-200">
                {TOOLBAR.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); exec(t.cmd, t.arg); }}
                    className={`px-2 py-1 rounded text-xs border border-gray-200 bg-white hover:bg-gray-100 transition-colors ${t.cls || ''}`}
                  >
                    {t.label}
                  </button>
                ))}
                <div className="w-px bg-gray-200 mx-1" />
                <button type="button" onMouseDown={(e) => { e.preventDefault(); insertImage(); }}
                  className="px-2 py-1 rounded text-xs border border-gray-200 bg-white hover:bg-gray-100">
                  🖼 Zdjęcie
                </button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); insertNote(); }}
                  className="px-2 py-1 rounded text-xs border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100">
                  💡 Wskazówka
                </button>
              </div>
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                className="min-h-[60vh] p-6 text-sm focus:outline-none
                  [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3
                  [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:pb-1
                  [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1
                  [&_p]:leading-relaxed [&_p]:mb-2
                  [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3
                  [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3
                  [&_li]:leading-relaxed [&_img]:max-w-full [&_img]:rounded-lg"
              />
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
              <div
                className="text-sm
                  [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-gray-900 [&_h1]:mt-6 [&_h1]:mb-3 [&_h1:first-child]:mt-0
                  [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-gray-800 [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-gray-100 [&_h2]:pb-2
                  [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-700 [&_h3]:mt-5 [&_h3]:mb-1
                  [&_p]:text-gray-700 [&_p]:leading-relaxed [&_p]:mb-3
                  [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_ul]:space-y-1.5
                  [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4 [&_ol]:space-y-1.5
                  [&_li]:text-gray-700 [&_li]:leading-relaxed
                  [&_strong]:font-semibold [&_strong]:text-gray-900
                  [&_hr]:border-gray-200 [&_hr]:my-6
                  [&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-gray-200 [&_img]:shadow-sm
                  [&_figure]:my-6 [&_figcaption]:text-xs [&_figcaption]:text-gray-400 [&_figcaption]:mt-1"
                dangerouslySetInnerHTML={{ __html: content }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
