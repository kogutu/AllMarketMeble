/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['mebel-partner.pl'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  experimental: {
    serverComponentsExternalPackages: ['mysql2'],
    // Pliki danych czytane przez `fs` po ścieżce budowanej w runtime — tracing Next ich nie wykryje,
    // więc trzeba je dołączyć ręcznie. W Next 14 ten klucz należy do `experimental`; na górnym
    // poziomie jest po cichu ignorowany (warning „Unrecognized key") i funkcja startuje bez danych.
    // Brak `mirakl_data/kaufland/categories.json` kosztował 35 s na publikację: klient nie znajdował
    // snapshotu drzewa kategorii i dociągał 6084 kategorie 61 żądaniami, aż do timeoutu funkcji.
    outputFileTracingIncludes: {
      '**': ['./data_market/**/*', './mirakl_data/**/*', './szablon_empik.xlsx'],
    },
  },
};

module.exports = nextConfig;
