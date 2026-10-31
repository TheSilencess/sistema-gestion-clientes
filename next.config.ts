import type { NextConfig } from 'next';

const isVercel = process.env.VERCEL === '1';
const backendUrl = process.env.BACKEND_URL?.replace(/\/+$/, '');

if (isVercel) {
  if (!backendUrl) throw new Error('Configura BACKEND_URL con la URL HTTPS de Hostinger.');
  const backend = new URL(backendUrl);
  const localTest = process.env.NODE_ENV === 'development' && backend.hostname === '127.0.0.1';
  if ((backend.protocol !== 'https:' && !localTest) || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) {
    throw new Error('BACKEND_URL debe ser el origen HTTPS de Hostinger, sin /api, credenciales ni parámetros.');
  }
}

const config: NextConfig = {
  ...(isVercel ? {} : { output: 'standalone' as const }),
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client'],
  async rewrites() {
    return {
      beforeFiles: isVercel
        ? [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }]
        : [],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default config;
