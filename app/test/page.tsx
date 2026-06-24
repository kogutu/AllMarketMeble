'use client';

import { useState, useEffect } from 'react';

export default function LoginPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getOffers = async () => {
      try {
        const response = await fetch('/api/offers/statuses', {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ids: ['999307792', '999307793'] // Tablica, nie string
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        setData(result);
        console.log('Otrzymane dane:', result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        console.error('Błąd:', err);
      } finally {
        setLoading(false);
      }
    };

    getOffers();
  }, []);

  if (loading) return <div>Ładowanie...</div>;
  if (error) return <div className="text-red-500">Błąd: {error}</div>;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div>test - dane załadowane</div>
    </div>
  );
}