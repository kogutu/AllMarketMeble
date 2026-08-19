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

export default function InstrukcjaPage() {
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

  // Wgraj treść do edytora gdy wchodzi w tryb edycji
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
      if (!res.ok) throw new Error('Błąd zapisu');
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

  if (loading) return <div className="max-w-4xl mx-auto p-8 text-gray-400 animate-pulse">Wczytywanie instrukcji…</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      {/* Nagłówek */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">📖 Instrukcja obsługi</h1>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button onClick={cancel} className="btn-secondary btn-sm">Anuluj</button>
              <button onClick={save} disabled={saving} className="btn-primary btn-sm">
                {saving ? 'Zapisywanie…' : '💾 Zapisz'}
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="btn-secondary btn-sm flex items-center gap-1.5">
              ✏ Edytuj instrukcję
            </button>
          )}
        </div>
      </div>

      {/* Tryb edycji */}
      {editing && (
        <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          {/* Pasek narzędzi */}
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
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertImage(); }}
              className="px-2 py-1 rounded text-xs border border-gray-200 bg-white hover:bg-gray-100"
            >
              🖼 Zdjęcie
            </button>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertNote(); }}
              className="px-2 py-1 rounded text-xs border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
            >
              💡 Wskazówka
            </button>
            <div className="ml-auto text-xs text-gray-400 self-center pr-1">
              Ctrl+B pogrubienie · Ctrl+I kursywa
            </div>
          </div>

          {/* Edytor */}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className={`
              min-h-[60vh] p-6 text-sm focus:outline-none
              [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-gray-900 [&_h1]:mt-6 [&_h1]:mb-3
              [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-gray-800 [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-gray-100 [&_h2]:pb-1
              [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-700 [&_h3]:mt-4 [&_h3]:mb-1
              [&_p]:text-gray-700 [&_p]:leading-relaxed [&_p]:mb-2
              [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ul]:space-y-1
              [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_ol]:space-y-1
              [&_li]:text-gray-700 [&_li]:leading-relaxed
              [&_strong]:font-semibold [&_em]:italic
              [&_hr]:border-gray-200 [&_hr]:my-4
              [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-gray-200
              [&_figure]:my-4
              [&_figcaption]:text-xs [&_figcaption]:text-gray-400 [&_figcaption]:mt-1
            `}
          />
        </div>
      )}

      {/* Tryb podglądu */}
      {!editing && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
          <div
            className={`
              prose prose-gray max-w-none text-sm
              [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-gray-900 [&_h1]:mt-6 [&_h1]:mb-3 [&_h1:first-child]:mt-0
              [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-gray-800 [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-gray-100 [&_h2]:pb-2
              [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-700 [&_h3]:mt-5 [&_h3]:mb-1
              [&_p]:text-gray-700 [&_p]:leading-relaxed [&_p]:mb-3
              [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_ul]:space-y-1.5
              [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4 [&_ol]:space-y-1.5
              [&_li]:text-gray-700 [&_li]:leading-relaxed
              [&_strong]:font-semibold [&_strong]:text-gray-900
              [&_em]:italic [&_em]:text-gray-600
              [&_hr]:border-gray-200 [&_hr]:my-6
              [&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-gray-200 [&_img]:shadow-sm
              [&_figure]:my-6 [&_figure]:text-center
              [&_figcaption]:text-xs [&_figcaption]:text-gray-400 [&_figcaption]:mt-2
            `}
            dangerouslySetInnerHTML={{ __html: content }}
          />
        </div>
      )}
    </div>
  );
}
