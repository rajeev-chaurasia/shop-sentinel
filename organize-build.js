import { rmSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  const htmlSource = join(__dirname, 'dist/src/popup/index.html');
  const htmlDest = join(__dirname, 'dist/index.html');
  
  // Read and fix HTML paths
  let html = readFileSync(htmlSource, 'utf-8');
  html = html.replace(/src=".*?popup\.js"/, 'src="./popup.js"');
  html = html.replace(/href=".*?assets\/(popup-.*?\.css)"/, 'href="./assets/$1"');
  
  // Write fixed HTML
  writeFileSync(htmlDest, html, 'utf-8');
  
  // Clean up src directory
  rmSync(join(__dirname, 'dist/src'), { recursive: true, force: true });
  
  console.log('✅ Build organized');
} catch (error) {
  console.error('❌ Failed:', error.message);
  process.exit(1);
}
