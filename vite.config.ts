import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import vercel from 'vite-plugin-vercel';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isDev = mode === 'development';
    const manifestApiKey = env.MANIFEST_API_KEY || process.env.MANIFEST_API_KEY || '';
    const manifestKeyNoPrefix = manifestApiKey.replace('users API-Key ', '').trim();

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: isDev ? {
          '/api/get-manifests': {
            target: 'https://qa-pld.lnc-live.com',
            changeOrigin: true,
            headers: {
              'Authorization': manifestApiKey,
              'Content-Type': 'application/json',
            },
          },
          '/api/get-manifest': {
            target: 'https://qa-pld.lnc-live.com',
            changeOrigin: true,
            headers: {
              // Use the same format as the working curl and list endpoint
              'Authorization': manifestApiKey,
            },
          },
        } : undefined,
      },
      plugins: [react(), ...(isDev ? [] : [vercel()])],
      define: {
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
