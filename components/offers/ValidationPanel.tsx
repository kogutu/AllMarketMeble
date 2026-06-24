'use client';

import clsx from 'clsx';
import { ValidationResult } from '@/types';

interface Props {
  result: ValidationResult;
}

export default function ValidationPanel({ result }: Props) {
  const color = result.valid
    ? 'border-green-300 bg-green-50'
    : result.score >= 60
    ? 'border-yellow-300 bg-yellow-50'
    : 'border-red-300 bg-red-50';

  const scoreColor =
    result.score >= 80
      ? 'text-green-700'
      : result.score >= 60
      ? 'text-yellow-700'
      : 'text-red-700';

  return (
    <div className={clsx('card p-4 border-2', color)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{result.valid ? '✅' : '⚠️'}</span>
            <span className="font-semibold text-gray-900">
              {result.valid ? 'Walidacja przeszła pomyślnie' : 'Znaleziono problemy'}
            </span>
            <span className={clsx('font-bold text-base', scoreColor)}>
              {result.score}/100
            </span>
          </div>

          <p className="text-sm text-gray-700 mb-3">{result.summary}</p>

          {result.issues.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-red-700 uppercase mb-1">Problemy:</p>
              <ul className="space-y-1">
                {result.issues.map((issue, i) => (
                  <li key={i} className="text-sm text-red-700 flex gap-2">
                    <span>•</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.suggestions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-blue-700 uppercase mb-1">Sugestie:</p>
              <ul className="space-y-1">
                {result.suggestions.map((sug, i) => (
                  <li key={i} className="text-sm text-blue-700 flex gap-2">
                    <span>💡</span>
                    <span>{sug}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Score circle */}
        <div className="shrink-0">
          <ScoreCircle score={result.score} />
        </div>
      </div>
    </div>
  );
}

function ScoreCircle({ score }: { score: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? '#16a34a' : score >= 60 ? '#d97706' : '#dc2626';

  return (
    <div className="flex flex-col items-center">
      <svg width="72" height="72" className="-rotate-90">
        <circle
          cx="36" cy="36" r={radius}
          fill="none" stroke="#e5e7eb" strokeWidth="6"
        />
        <circle
          cx="36" cy="36" r={radius}
          fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <span className="text-xs font-bold mt-1" style={{ color }}>
        {score}%
      </span>
    </div>
  );
}
