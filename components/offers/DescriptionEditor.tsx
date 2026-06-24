'use client';

import { useState } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export default function DescriptionEditor({ value, onChange }: Props) {
  const [preview, setPreview] = useState(false);

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">
          Opis aukcji
        </h3>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          <button
            onClick={() => setPreview(false)}
            className={`text-xs px-3 py-1 rounded-md transition-colors ${
              !preview ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Edytor
          </button>
          <button
            onClick={() => setPreview(true)}
            className={`text-xs px-3 py-1 rounded-md transition-colors ${
              preview ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Podgląd
          </button>
        </div>
      </div>

      {preview ? (
        <div
          className="min-h-[260px] p-3 border border-gray-200 rounded-lg text-sm prose prose-sm max-w-none overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: value || '<p class="text-gray-400">Brak opisu</p>' }}
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input resize-none"
          rows={12}
          placeholder="Wpisz opis aukcji lub użyj przycisku 'Generuj opis' powyżej..."
        />
      )}

      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{value.length} znaków</span>
        {value.length > 0 && (
          <button onClick={() => onChange('')} className="text-red-400 hover:text-red-600">
            Wyczyść
          </button>
        )}
      </div>
    </div>
  );
}
