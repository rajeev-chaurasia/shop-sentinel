/**
 * Vite plugin to properly bundle content scripts
 * Content scripts cannot use ES modules or code splitting
 */

import { build } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function contentScriptPlugin() {
  let isBuilding = false;

  return {
    name: 'content-script-builder',
    apply: 'build',
    
    async closeBundle() {
      if (isBuilding) return;
      isBuilding = true;

      console.log('\n🔨 Building content script...');

      try {
        await build({
          configFile: false,
          build: {
            outDir: 'dist',
            emptyOutDir: false,
            lib: {
              entry: resolve(__dirname, 'src/content/content.ts'),
              name: 'ContentScript',
              formats: ['iife'],
              fileName: () => 'content.js',
            },
            rollupOptions: {
              output: {
                extend: true,
                inlineDynamicImports: true,
              },
            },
            minify: true,
          },
        });

        console.log('✅ Content script built');
        
        // Build background service worker
        console.log('\n🔨 Building background service worker...');
        
        await build({
          configFile: false,
          build: {
            outDir: 'dist',
            emptyOutDir: false,
            lib: {
              entry: resolve(__dirname, 'src/background/background.ts'),
              name: 'BackgroundWorker',
              formats: ['iife'],
              fileName: () => 'background.js',
            },
            rollupOptions: {
              output: {
                extend: true,
                inlineDynamicImports: true,
              },
            },
            minify: true,
          },
        });

        console.log('✅ Background service worker built');
      } catch (error) {
        console.error('❌ Build failed:', error);
        throw error;
      }
    },
  };
}
