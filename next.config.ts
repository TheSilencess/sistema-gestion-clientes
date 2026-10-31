import type { NextConfig } from 'next';

const config: NextConfig = {
  ...(process.env.VERCEL === '1'
    ? {}
    : { output: 'standalone' as const }),
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client'],
};

export default config;