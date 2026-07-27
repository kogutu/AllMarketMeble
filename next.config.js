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
  },
  // Ensure data_market files (XLSX templates, JSON value lists) are bundled in Vercel deployment
  outputFileTracingIncludes: {
    '**': ['./data_market/**/*', './szablon_empik.xlsx'],
  },
};

module.exports = nextConfig;
