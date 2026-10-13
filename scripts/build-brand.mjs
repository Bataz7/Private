// Exports the Rift brand images to PNG (for the Discord bot avatar/banner and social previews).
// Output: assets/brand/rift-logo.png (1024), rift-logo-256.png, rift-banner.png (1500x500). Run: npm run brand
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const pub = resolve(root, 'src/dashboard/public');
const out = resolve(root, 'assets/brand');
mkdirSync(out, { recursive: true });

const logo = readFileSync(resolve(pub, 'logo.svg'));
await sharp(logo, { density: 384 }).resize(1024, 1024).png({ compressionLevel: 9 }).toFile(resolve(out, 'rift-logo.png'));
await sharp(logo, { density: 192 }).resize(256, 256).png({ compressionLevel: 9 }).toFile(resolve(out, 'rift-logo-256.png'));
await sharp(readFileSync(resolve(pub, 'brand-banner.svg')), { density: 144 }).resize(1500, 500).png({ compressionLevel: 9 }).toFile(resolve(out, 'rift-banner.png'));
console.log('Built assets/brand/rift-logo.png, rift-logo-256.png and rift-banner.png');
