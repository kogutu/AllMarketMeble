'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import clsx from 'clsx';

// ── Allegro description types ─────────────────────────────────────────────────

export type DescTextItem  = { type: 'TEXT';  content: string };
export type DescImageItem = { type: 'IMAGE'; url: string };
export type DescItem      = DescTextItem | DescImageItem;
export type DescSection   = { items: DescItem[] };
export type DescSections  = { sections: DescSection[] };

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseSections(value: string): DescSections | null {
  if (!value) return null;
  try {
    const p = JSON.parse(value);
    if (p?.sections && Array.isArray(p.sections)) return p as DescSections;
  } catch {}
  return null;
}

export function sectionsToHtml(sections: DescSection[]): string {
  return sections.map(s =>
    s.items.map(item =>
      item.type === 'IMAGE'
        ? `<img src="${item.url}" alt="" style="max-width:100%;height:auto;display:block;margin:8px 0" />`
        : item.content
    ).join('')
  ).join('<div style="margin:12px 0"></div>');
}

function serialize(sections: DescSection[]): string {
  return JSON.stringify({ sections });
}

function emptyText(): DescTextItem  { return { type: 'TEXT',  content: '' }; }
function emptyImage(): DescImageItem { return { type: 'IMAGE', url: '' }; }

// ── Section layout templates ──────────────────────────────────────────────────

type LayoutId = 'text' | 'image' | 'image_text' | 'text_image' | '2images';

const LAYOUTS: { id: LayoutId; label: string; preview: string }[] = [
  { id: 'text',       label: 'Tekst',              preview: '▬' },
  { id: 'image',      label: 'Zdjęcie',             preview: '▨' },
  { id: 'image_text', label: 'Zdjęcie + tekst',     preview: '▨▬' },
  { id: 'text_image', label: 'Tekst + zdjęcie',     preview: '▬▨' },
  { id: '2images',    label: '2 zdjęcia',           preview: '▨▨' },
];

function makeSection(layout: LayoutId): DescSection {
  switch (layout) {
    case 'text':       return { items: [emptyText()] };
    case 'image':      return { items: [emptyImage()] };
    case 'image_text': return { items: [emptyImage(), emptyText()] };
    case 'text_image': return { items: [emptyText(), emptyImage()] };
    case '2images':    return { items: [emptyImage(), emptyImage()] };
  }
}

// ── Rich text editor (WYSIWYG, Allegro-compliant tags only) ──────────────────

// Maps browser-produced tags to Allegro-allowed equivalents.
const TAG_MAP: Record<string, string> = {
  B: 'strong', STRONG: 'strong',
  I: 'em', EM: 'em',
  U: 'u',
  H1: 'h1', H2: 'h2', H3: 'h3',
  P: 'p',
  UL: 'ul', OL: 'ol', LI: 'li',
  BR: 'br',
};

function cleanNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName;
  const children = () => Array.from(el.childNodes).map(cleanNode).join('');
  if (tag === 'BR') return '<br>';
  const mapped = TAG_MAP[tag];
  if (mapped) return `<${mapped}>${children()}</${mapped}>`;
  // DIV, SPAN, etc. — unwrap, keep children
  return children();
}

function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.body.childNodes).map(cleanNode).join('');
}

type ToolbarBtn = { label: string; cmd: string; arg?: string; title: string; cls?: string };

const TOOLBAR: ToolbarBtn[] = [
  { label: 'H1', cmd: 'formatBlock', arg: 'h1', title: 'Nagłówek 1', cls: 'font-bold' },
  { label: 'H2', cmd: 'formatBlock', arg: 'h2', title: 'Nagłówek 2', cls: 'font-semibold' },
  { label: 'H3', cmd: 'formatBlock', arg: 'h3', title: 'Nagłówek 3' },
  { label: 'P',  cmd: 'formatBlock', arg: 'p',  title: 'Akapit' },
  { label: 'B',  cmd: 'bold',   title: 'Pogrubienie', cls: 'font-bold' },
  { label: 'I',  cmd: 'italic', title: 'Kursywa',     cls: 'italic' },
  { label: 'U',  cmd: 'underline', title: 'Podkreślenie', cls: 'underline' },
  { label: '• Lista', cmd: 'insertUnorderedList', title: 'Lista punktowana' },
  { label: '1. Lista', cmd: 'insertOrderedList',  title: 'Lista numerowana' },
];

function RichTextEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastRef   = useRef(value);

  // Set initial HTML once (avoids cursor-reset on every re-render)
  useLayoutEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = value;
      lastRef.current = value;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync when value changes externally (e.g. load from Allegro)
  useEffect(() => {
    const el = editorRef.current;
    if (!el || value === lastRef.current) return;
    el.innerHTML = value;
    lastRef.current = value;
  }, [value]);

  const flush = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const clean = sanitizeHtml(el.innerHTML);
    lastRef.current = clean;
    onChange(clean);
  }, [onChange]);

  const exec = useCallback((cmd: string, arg?: string) => {
    editorRef.current?.focus();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand(cmd, false, arg);
    flush();
  }, [flush]);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-200 focus-within:border-blue-300">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-0.5 p-1.5 bg-gray-50 border-b border-gray-200">
        {TOOLBAR.map((t) => (
          <button
            key={t.label}
            type="button"
            title={t.title}
            onMouseDown={(e) => { e.preventDefault(); exec(t.cmd, t.arg); }}
            className={clsx(
              'px-2 py-0.5 rounded text-xs border border-gray-200 bg-white hover:bg-gray-100 active:bg-gray-200 transition-colors text-gray-700 select-none',
              t.cls
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={flush}
        onBlur={flush}
        className="min-h-[120px] max-h-[320px] overflow-y-auto p-3 text-sm focus:outline-none
          [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-2
          [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mb-1.5
          [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mb-1
          [&_p]:mb-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5
          [&_li]:mb-0.5 [&_strong]:font-bold [&_em]:italic [&_u]:underline"
      />
    </div>
  );
}

// ── Item editor ───────────────────────────────────────────────────────────────

function TextItemEditor({ item, onChange }: { item: DescTextItem; onChange: (v: DescTextItem) => void }) {
  return (
    <RichTextEditor
      value={item.content}
      onChange={(v) => onChange({ ...item, content: v })}
    />
  );
}

function ImageItemEditor({ item, onChange, galleryImages }: {
  item: DescImageItem;
  onChange: (v: DescImageItem) => void;
  galleryImages: string[];
}) {
  const [showGallery, setShowGallery] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-start">
        <input
          className="input text-sm flex-1"
          value={item.url}
          onChange={e => onChange({ ...item, url: e.target.value })}
          placeholder="URL zdjęcia (https://a.allegroimg.com/...)"
        />
        {galleryImages.length > 0 && (
          <button
            type="button"
            onClick={() => setShowGallery(v => !v)}
            className="btn-secondary btn-sm text-xs shrink-0"
          >
            {showGallery ? 'Zamknij' : 'Galeria'}
          </button>
        )}
      </div>
      {item.url && (
        <img
          src={item.url}
          alt=""
          className="max-h-28 rounded border border-gray-200 object-contain"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      {showGallery && (
        <div className="grid grid-cols-4 gap-1.5 p-2 bg-gray-50 rounded-lg border border-gray-200 max-h-48 overflow-y-auto">
          {galleryImages.map(url => (
            <button
              key={url}
              type="button"
              onClick={() => { onChange({ ...item, url }); setShowGallery(false); }}
              className={clsx(
                'rounded overflow-hidden border-2 transition-colors',
                item.url === url ? 'border-allegro' : 'border-transparent hover:border-gray-300'
              )}
            >
              <img src={url} alt="" className="w-full h-14 object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section editor ────────────────────────────────────────────────────────────

function SectionEditor({
  section, index, total, galleryImages,
  onChange, onMove, onRemove,
}: {
  section: DescSection;
  index: number;
  total: number;
  galleryImages: string[];
  onChange: (s: DescSection) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const updateItem = (i: number, item: DescItem) => {
    const items = [...section.items];
    items[i] = item;
    onChange({ items });
  };

  const layoutLabel = () => {
    const types = section.items.map(i => i.type);
    if (types.length === 1 && types[0] === 'TEXT')  return '▬ Tekst';
    if (types.length === 1 && types[0] === 'IMAGE') return '▨ Zdjęcie';
    if (types.length === 2 && types[0] === 'IMAGE' && types[1] === 'TEXT')  return '▨▬ Zdjęcie + tekst';
    if (types.length === 2 && types[0] === 'TEXT'  && types[1] === 'IMAGE') return '▬▨ Tekst + zdjęcie';
    if (types.length === 2 && types[0] === 'IMAGE' && types[1] === 'IMAGE') return '▨▨ 2 zdjęcia';
    return `Sekcja`;
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-mono text-gray-500 font-semibold">{index + 1}</span>
        <span className="text-xs text-gray-600 flex-1">{layoutLabel()}</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="p-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30"
            title="Przesuń wyżej"
          >↑</button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className="p-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30"
            title="Przesuń niżej"
          >↓</button>
          <button
            type="button"
            onClick={onRemove}
            className="p-1 rounded text-red-400 hover:text-red-600 ml-1"
            title="Usuń sekcję"
          >✕</button>
        </div>
      </div>

      {/* Items */}
      <div className={clsx(
        'p-3 gap-3',
        section.items.length > 1 ? 'grid grid-cols-2' : 'flex flex-col'
      )}>
        {section.items.map((item, i) => (
          <div key={i} className="space-y-1">
            <span className="text-xs text-gray-400 font-medium">
              {item.type === 'TEXT' ? 'Tekst' : 'Zdjęcie'}
            </span>
            {item.type === 'TEXT' ? (
              <TextItemEditor item={item} onChange={v => updateItem(i, v)} />
            ) : (
              <ImageItemEditor item={item} onChange={v => updateItem(i, v)} galleryImages={galleryImages} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  value: string;
  onChange: (value: string) => void;
  galleryImages?: string[];
}

export default function DescriptionEditor({ value, onChange, galleryImages = [] }: Props) {
  const [preview, setPreview] = useState(false);

  // Parse sections from JSON string (native Allegro format).
  // Legacy plain-HTML drafts are treated as empty — user rebuilds in block editor.
  const parsed = parseSections(value);
  const sections: DescSection[] = parsed?.sections ?? [];
  if (typeof window !== 'undefined') {
    console.log('[DescriptionEditor] value length:', value?.length, '| parsed sections:', sections.length);
  }

  const update = (newSections: DescSection[]) => {
    onChange(serialize(newSections));
  };

  const addSection = (layout: LayoutId) => {
    update([...sections, makeSection(layout)]);
  };

  const updateSection = (i: number, s: DescSection) => {
    const next = [...sections];
    next[i] = s;
    update(next);
  };

  const moveSection = (i: number, dir: -1 | 1) => {
    const next = [...sections];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };

  const removeSection = (i: number) => {
    update(sections.filter((_, idx) => idx !== i));
  };

  return (
    <div className="card p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">
          Opis aukcji (Allegro sekcje)
        </h3>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          <button
            onClick={() => setPreview(false)}
            className={`text-xs px-3 py-1 rounded-md transition-colors ${!preview ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Edytor
          </button>
          <button
            onClick={() => setPreview(true)}
            className={`text-xs px-3 py-1 rounded-md transition-colors ${preview ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Podgląd
          </button>
        </div>
      </div>

      {preview ? (
        <div
          className="min-h-[260px] p-3 border border-gray-200 rounded-lg text-sm prose prose-sm max-w-none overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: sections.length ? sectionsToHtml(sections) : '<p class="text-gray-400">Brak opisu</p>' }}
        />
      ) : (
        <div className="space-y-3">
          {sections.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">
              Brak sekcji — dodaj blok za pomocą przycisków poniżej
            </p>
          )}

          {sections.map((s, i) => (
            <SectionEditor
              key={i}
              section={s}
              index={i}
              total={sections.length}
              galleryImages={galleryImages}
              onChange={s2 => updateSection(i, s2)}
              onMove={dir => moveSection(i, dir)}
              onRemove={() => removeSection(i)}
            />
          ))}

          {/* Add section buttons */}
          <div className="pt-1">
            <p className="text-xs text-gray-500 mb-2 font-medium">Dodaj sekcję:</p>
            <div className="flex flex-wrap gap-2">
              {LAYOUTS.map(l => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => addSection(l.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors font-mono"
                >
                  <span className="text-gray-400">{l.preview}</span>
                  <span className="font-sans">{l.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{sections.length} sekcji · {sections.reduce((n, s) => n + s.items.length, 0)} elementów</span>
        {sections.length > 0 && (
          <button onClick={() => update([])} className="text-red-400 hover:text-red-600">
            Wyczyść
          </button>
        )}
      </div>
    </div>
  );
}
