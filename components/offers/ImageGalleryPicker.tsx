'use client';

import Image from 'next/image';
import clsx from 'clsx';
import { useRef, useState } from 'react';

interface Props {
  allImages: string[];
  selected: string[];
  onChange: (images: string[]) => void;
}

export default function ImageGalleryPicker({ allImages, selected, onChange }: Props) {
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const dragFromIdx = useRef<number | null>(null);

  const toggle = (url: string) => {
    if (selected.includes(url)) {
      onChange(selected.filter((u) => u !== url));
    } else {
      onChange([...selected, url]);
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= selected.length) return;
    const arr = [...selected];
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    onChange(arr);
  };

  const handleDragStart = (i: number) => { dragFromIdx.current = i; };
  const handleDragEnd = () => { dragFromIdx.current = null; setDragOverIdx(null); };
  const handleDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOverIdx(i); };
  const handleDrop = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragFromIdx.current !== null && dragFromIdx.current !== i) move(dragFromIdx.current, i);
    setDragOverIdx(null);
    dragFromIdx.current = null;
  };

  if (allImages.length === 0) {
    return (
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 text-sm uppercase tracking-wide mb-3">Zdjęcia</h3>
        <p className="text-sm text-gray-400 text-center py-4">Brak zdjęć do wyboru dla tego produktu</p>
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">
          Zdjęcia ({selected.length}/{allImages.length})
        </h3>
        <div className="flex gap-2 text-xs">
          <button type="button" onClick={() => onChange([...allImages])} className="text-allegro hover:underline">
            Zaznacz wszystkie
          </button>
          <span className="text-gray-300">|</span>
          <button type="button" onClick={() => onChange([])} className="text-gray-500 hover:underline">
            Wyczyść
          </button>
        </div>
      </div>

      {/* ── Selected images — reorderable ───────────────────────────────── */}
      {selected.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-500">Kolejność w ofercie — przeciągnij lub użyj strzałek:</p>
          {selected.map((url, i) => (
            <div
              key={url}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={(e) => handleDrop(e, i)}
              className={clsx(
                'flex items-center gap-2 px-2 py-1.5 rounded-lg border-2 bg-white select-none transition-colors cursor-grab active:cursor-grabbing',
                dragOverIdx === i
                  ? 'border-allegro bg-allegro/5 shadow-sm'
                  : 'border-gray-100 hover:border-gray-200'
              )}
            >
              {/* Drag handle */}
              <span className="text-gray-300 shrink-0 leading-none text-base px-0.5" title="Przeciągnij">⠿</span>

              {/* Position badge */}
              <span className={clsx(
                'w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                i === 0 ? 'bg-allegro text-white' : 'bg-gray-100 text-gray-500'
              )}>
                {i + 1}
              </span>

              {/* Thumbnail */}
              <div className="relative w-12 h-9 rounded overflow-hidden shrink-0 border border-gray-100">
                <Image src={url} alt={`Zdjęcie ${i + 1}`} fill className="object-cover" unoptimized />
              </div>

              {/* Label */}
              <span className="text-xs flex-1 truncate min-w-0">
                {i === 0
                  ? <span className="text-allegro font-semibold">Miniatura aukcji</span>
                  : <span className="text-gray-400">Zdjęcie {i + 1}</span>}
              </span>

              {/* Up / Down */}
              <div className="flex flex-col gap-px shrink-0">
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  className="w-5 h-4 flex items-center justify-center text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed text-xs leading-none"
                  title="Przesuń wyżej"
                >▲</button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === selected.length - 1}
                  className="w-5 h-4 flex items-center justify-center text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed text-xs leading-none"
                  title="Przesuń niżej"
                >▼</button>
              </div>

              {/* Remove */}
              <button
                type="button"
                onClick={() => toggle(url)}
                className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 shrink-0 transition-colors text-sm leading-none"
                title="Usuń z oferty"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ── All images grid — click to toggle ───────────────────────────── */}
      <div className="space-y-1.5">
        {selected.length > 0 && (
          <p className="text-xs text-gray-400">Kliknij aby dodać lub usunąć ze zdjęć oferty:</p>
        )}
        <div className="grid grid-cols-4 gap-2">
          {allImages.map((url, i) => {
            const isSelected = selected.includes(url);
            const pos = selected.indexOf(url);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggle(url)}
                className={clsx(
                  'relative aspect-square rounded-lg overflow-hidden border-2 transition-all',
                  isSelected
                    ? 'border-allegro ring-2 ring-allegro/30'
                    : 'border-gray-200 hover:border-gray-400'
                )}
              >
                <Image src={url} alt={`Zdjęcie ${i + 1}`} fill className="object-cover" unoptimized />

                {isSelected ? (
                  <div className="absolute inset-0 bg-allegro/20 flex items-center justify-center">
                    <span className={clsx(
                      'w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold',
                      pos === 0 ? 'bg-allegro ring-2 ring-white' : 'bg-allegro'
                    )}>
                      {pos + 1}
                    </span>
                  </div>
                ) : (
                  <div className="absolute bottom-1 right-1 bg-black/50 text-white text-xs rounded px-1 leading-tight">
                    {i + 1}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Pierwsze zdjęcie na liście będzie miniaturką aukcji na Allegro. Maks. 15 zdjęć.
      </p>
    </div>
  );
}
