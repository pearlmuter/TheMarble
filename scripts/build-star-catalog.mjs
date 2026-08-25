import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('Usage: node scripts/build-star-catalog.mjs input.tsv output.json');

const lines = (await readFile(inputPath, 'utf8')).split(/\r?\n/);
const stars = [];
const seen = new Set();

for (const line of lines) {
  if (!line || line.startsWith('#') || line.startsWith('HIP') || line.startsWith(' ') && line.trim() === 'deg') continue;
  const columns = line.split('\t');
  if (columns.length < 5) continue;
  const hip = Number(columns[0]);
  const ra = Number(columns[1]);
  const dec = Number(columns[2]);
  const magnitude = Number(columns[3]);
  const colorIndex = Number(columns[4]);
  if (!Number.isFinite(hip) || !Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(magnitude) || seen.has(hip)) continue;
  seen.add(hip);
  stars.push([
    Number(ra.toFixed(6)),
    Number(dec.toFixed(6)),
    Number(magnitude.toFixed(3)),
    Number((Number.isFinite(colorIndex) ? colorIndex : .65).toFixed(3)),
  ]);
}

await writeFile(outputPath, JSON.stringify({
  source: 'ESA Hipparcos-2 via CDS VizieR I/311/hip2',
  epoch: 1991.25,
  magnitudeLimit: 8,
  stars,
}));

console.log(`Wrote ${stars.length.toLocaleString()} unique Hipparcos stars to ${outputPath}`);
