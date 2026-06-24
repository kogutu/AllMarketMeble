/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['oponymaster.eu'],
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
