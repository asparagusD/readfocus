// Copy Excalidraw's fonts into public/excalidraw-assets/ (C22.3), so drawings load them from our own origin.
// DrawingEditor.jsx sets window.EXCALIDRAW_ASSET_PATH to this folder; Excalidraw falls back to esm.sh only for
// a file it cannot find here, so every family is copied (about 12.5 MB, fetched one face at a time when used).
// Runs before `vite` and `vite build` (npm's predev and prebuild); the folder is not committed. The package
// ships no licence file (its package.json says MIT); a notice naming the source goes with the fonts.
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'node_modules', '@excalidraw', 'excalidraw');
const out = join(root, 'public', 'excalidraw-assets');

mkdirSync(out, { recursive: true });
cpSync(join(pkg, 'dist', 'prod', 'fonts'), join(out, 'fonts'), { recursive: true });
const { version, license } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
writeFileSync(join(out, 'NOTICE.txt'), `Fonts from @excalidraw/excalidraw ${version} (${license}), dist/prod/fonts, `
  + 'as published on npm. Excalifont, Virgil, Nunito, Cascadia, Liberation, Lilita, Xiaolai: SIL Open Font '
  + 'Licence 1.1; Comic Shanns: MIT. https://github.com/excalidraw/excalidraw\n');
console.log(`Excalidraw fonts copied to public/excalidraw-assets (${readdirSync(join(out, 'fonts')).length} families)`);
