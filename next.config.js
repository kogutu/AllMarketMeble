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
};

module.exports = nextConfig;
