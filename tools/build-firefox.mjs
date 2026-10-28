// Firefox paketi üretir: `cikti/youtube-ceviri-firefox/` (yüklemeye hazır klasör)
// ve `cikti/youtube-ceviri-firefox.zip` (imzalatmak / .xpi yapmak için).
//
// Kullanım:  node tools/build-firefox.mjs
// Bağımlılık yok; Node 18+ yeterli.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { toFirefoxManifest, validateFirefoxManifest } from './firefox-manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.resolve(root, '..', 'youtube-ceviri-firefox');
const zipPath = path.resolve(root, '..', 'youtube-ceviri-firefox.zip');
const MARKER = 'GENERATED-BY-build-firefox.txt';

/* ------------------------------------------------------------------ */
/* Klasör hazırlığı                                                   */
/* ------------------------------------------------------------------ */

if (existsSync(outDir)) {
  // Yalnızca bu betiğin ürettiği klasörü temizle; başka bir klasöre dokunma.
  if (!existsSync(path.join(outDir, MARKER))) {
    console.error(`DURDU: ${outDir} bu betikle üretilmemiş, silmiyorum.`);
    process.exit(1);
  }
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

/* ------------------------------------------------------------------ */
/* Dosyalar                                                           */
/* ------------------------------------------------------------------ */

function copyTree(from, to, skip = new Set()) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst, skip);
    else if (entry.isFile()) copyFileSync(src, dst);
  }
}

copyTree(path.join(root, 'src'), path.join(outDir, 'src'));
copyFileSync(path.join(root, 'README.md'), path.join(outDir, 'README.md'));

const chromeManifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const firefoxManifest = toFirefoxManifest(chromeManifest);

const problems = validateFirefoxManifest(firefoxManifest, chromeManifest);
if (problems.length) {
  console.error('Firefox manifest sorunları:');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}

writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(firefoxManifest, null, 2) + '\n',
  'utf8'
);
writeFileSync(
  path.join(outDir, MARKER),
  'Bu klasör tools/build-firefox.mjs tarafından üretildi; elle düzenlemeyin.\n',
  'utf8'
);

/* ------------------------------------------------------------------ */
/* ZIP (sıkıştırmasız, imzalama/AMO için)                             */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, rel));
    else if (entry.isFile() && rel !== MARKER) out.push({ rel, full });
  }
  return out;
}

function buildZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const { rel, data } of files) {
    const name = Buffer.from(rel, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralBuf, eocd]);
}

const entries = walk(outDir).map(({ rel, full }) => ({
  rel,
  data: readFileSync(full),
  size: statSync(full).size
}));
writeFileSync(zipPath, buildZip(entries));

/* ------------------------------------------------------------------ */
/* Özet                                                               */
/* ------------------------------------------------------------------ */

const total = entries.reduce((sum, e) => sum + e.size, 0);
console.log(`Firefox klasörü : ${outDir}`);
console.log(`ZIP             : ${zipPath}`);
console.log(`Dosya           : ${entries.length} (${Math.round(total / 1024)} KB)`);
console.log(`Asgari Firefox  : ${firefoxManifest.browser_specific_settings.gecko.strict_min_version}`);
console.log('Kurulum: Firefox → about:debugging#/runtime/this-firefox → "Geçici eklenti yükle" →');
console.log('         yukarıdaki klasördeki manifest.json dosyasını seç.');
