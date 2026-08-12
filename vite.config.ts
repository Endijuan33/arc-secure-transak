/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    /**
     * Raised above the default 500 kB because the `appkit` vendor chunk is
     * ~1.8 MB and cannot be split further: Reown's connector registry, its Lit
     * web components, and the WalletConnect provider are a single dependency
     * graph. It is also not on the critical path — the modal only loads when the
     * user opens it. Application code sits in far smaller chunks, so a real
     * regression there would still trip this warning.
     */
    chunkSizeWarningLimit: 1900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          ethers: ['ethers'],
          appkit: ['@reown/appkit', '@reown/appkit-adapter-ethers'],
        },
      },
    },
  },
  test: {
    globals: true,
    /**
     * `node`, not `jsdom`.
     *
     * vitest's jsdom environment runs in a separate V8 realm, so Node's
     * `Buffer` — which is what ethers' Node build returns from its hashing
     * primitives — is not `instanceof` the jsdom realm's `Uint8Array`. ethers
     * then rejects its own output with "invalid BytesLike value", which makes
     * `Wallet.createRandom()` unusable under jsdom.
     *
     * Everything the suite needs is available natively in the Node realm:
     * WebCrypto for the AES-GCM vault, `fake-indexeddb` for history, and a
     * `Storage` shim from `tests/setup.ts` for the address book. No component
     * rendering is involved, so there is nothing a DOM would add.
     */
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/types/**',
        // Presentational and wiring-only modules: exercising them would require
        // a DOM realm, which this suite deliberately avoids (see `environment`).
        'src/components/**',
        'src/pages/**',
        'src/config/appkit.ts',
      ],
    },
  },
});
