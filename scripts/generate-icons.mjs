import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const publicDirectory = path.join(projectRoot, 'public');
const sourcePath = path.join(publicDirectory, 'icon.svg');
const source = await readFile(sourcePath);

await mkdir(publicDirectory, { recursive: true });

for (const size of [192, 512, 180]) {
  const filename = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  await sharp(source).resize(size, size).png().toFile(path.join(publicDirectory, filename));
}

await sharp(source)
  .resize(512, 512, { fit: 'contain', background: '#4f46e5' })
  .png()
  .toFile(path.join(publicDirectory, 'icon-maskable-512.png'));
