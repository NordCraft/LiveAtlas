// noinspection JSUnusedGlobalSymbols

import {defineConfig, loadEnv} from 'vite';
import { resolve } from 'path';
import vue from '@vitejs/plugin-vue';
import svgSpritePlugin from "vite-plugin-svg-sprite-component";
import analyze from 'rollup-plugin-analyzer';
import { splitVendorChunkPlugin } from 'vite';
import { readFileSync } from 'fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())

  // expose .env as process.env instead of import.meta since jest does not import meta yet
  const envWithProcessPrefix = Object.entries(env).reduce(
    (prev, [key, val]) => {
      return {
        ...prev,
        ['process.env.' + key]: `"${val}"`,
      }
    },
    {},
  );

  const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

  return {
    plugins: [splitVendorChunkPlugin(), vue(), analyze(), svgSpritePlugin({
      symbolId: (name) => `icon--${name}`,
      removeAttrs: ['xmlns', 'width', 'height', 'version']
    })],
    base: './',
    server: {
    host: '0.0.0.0',
      port: 8080
    },
    resolve: {
      alias: [
        {
          find: '@',
          replacement: resolve(__dirname, 'src')
        }
      ]
    },
    build: {
      chunkSizeWarningLimit: 600,
      assetsDir: 'live-atlas/assets'
    },
    define: {
      ...envWithProcessPrefix,
      'process.env.VITE_APP_VERSION': `"${pkg.version}"`,
    },
    test: {
      globals: true,
      environment: 'jsdom',
    },
  }
});
