// Copy tesseract.js's worker, core and English model into public/ocr/ (C19.4), so the reader's
// OCR loads them from our own origin, never a CDN. Runs before `vite` and `vite build` (npm's
// predev and prebuild); public/ocr/ is not committed. Licences go with the files.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(root, 'node_modules');
const out = join(root, 'public', 'ocr');
const files = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  // The worker picks the fastest core the browser supports from these three (relaxed SIMD, SIMD, plain).
  'core/tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'core/tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'core/tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  // English, the integer "best" LSTM model (2.9 MB gzipped).
  'lang/eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  'LICENSES/tesseract.js.LICENSE.md': 'tesseract.js/LICENSE.md',
  'LICENSES/tesseract.js-core.LICENSE': 'tesseract.js-core/LICENSE',
};

for (const [to, from] of Object.entries(files)) {
  const target = join(out, to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(modules, from), target);
}
console.log(`OCR assets copied to public/ocr (${Object.keys(files).length} files)`);
