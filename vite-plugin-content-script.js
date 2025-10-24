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
        
        // Note: Service worker is built by main vite config
        console.log('✅ Service worker already built by main config');
      } catch (error) {
        console.error('❌ Build failed:', error);
        throw error;
      }
    },
  };
}
