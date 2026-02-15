#!/usr/bin/env node
/**
 * Benchmark report generator.
 *
 * Runs each reference PDF through the full pipeline and writes
 * a formatted markdown report to docs/benchmark-results.md.
 *
 * Usage: node scripts/benchmark-report.js
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimize } from '../src/engine/pipeline.js';
import {
  createIllustratorStylePdf,
  createPhotoHeavyPdf,
  createTaggedAccessiblePdf,
  createPdfA1bDocument,
  createMultiFontDuplicatesPdf,
  createKitchenSinkPdf,
} from '../test/fixtures/create-benchmark-pdfs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../docs/benchmark-results.md');

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function pct(n) {
  return `${n.toFixed(1)}%`;
}

async function runBenchmark(name, createFn, options = {}) {
  const inputBytes = await createFn();
  const t0 = performance.now();
  const { output, stats } = await optimize(inputBytes, options);
  const elapsed = performance.now() - t0;

  return {
    name,
    inputSize: inputBytes.length,
    outputSize: output.length,
    savedBytes: stats.savedBytes,
    savedPercent: stats.savedPercent,
    sizeGuard: stats.sizeGuard || false,
    elapsed: Math.round(elapsed),
    pdfTraits: stats.pdfTraits,
    passes: stats.passes,
    inspect: stats.inspect,
  };
}

function passTable(passes) {
  const rows = ['| Pass | Result | Time |', '|------|--------|------|'];
  for (const p of passes) {
    if (p.error) {
      rows.push(`| ${p.name} | error: ${p.error} | — |`);
      continue;
    }
    const details = [];
    if (p.recompressed != null) details.push(`${p.recompressed} recompressed`);
    if (p.converted != null) details.push(`${p.converted} converted`);
    if (p.downsampled != null && p.downsampled > 0) details.push(`${p.downsampled} downsampled`);
    if (p.skipped != null && p.skipped > 0) details.push(`${p.skipped} skipped`);
    if (p.unembedded != null) details.push(`${p.unembedded} unembedded`);
    if (p.pdfaSkipped) details.push('PDF/A skipped');
    if (p.pdfuaSkipped) details.push('PDF/UA skipped');
    if (p.subsetted != null) details.push(`${p.subsetted} subsetted`);
    if (p.deduplicated != null) details.push(`${p.deduplicated} deduplicated`);
    if (p.stripped != null) details.push(`${p.stripped} stripped`);
    if (p.xmpPreserved) details.push('XMP preserved');
    if (p.removed != null) details.push(`${p.removed} removed`);
    const detail = details.length ? details.join(', ') : '—';
    rows.push(`| ${p.name} | ${detail} | ${p._ms}ms |`);
  }
  return rows.join('\n');
}

function traitsLine(traits) {
  const parts = [];
  if (traits.isPdfA) parts.push(`PDF/A-${traits.pdfALevel}`);
  if (traits.isPdfUA) parts.push('PDF/UA');
  if (traits.isTagged) parts.push('Tagged');
  if (traits.hasStructTree) parts.push('StructTree');
  if (traits.lang) parts.push(`Lang=${traits.lang}`);
  return parts.length ? parts.join(', ') : 'None';
}

function inspectSummary(inspect) {
  if (!inspect?.before || !inspect?.after) return '';
  const b = inspect.before;
  const a = inspect.after;
  const lines = [
    `| Metric | Before | After |`,
    `|--------|--------|-------|`,
    `| Objects | ${b.objectCount} | ${a.objectCount} |`,
    `| Total stream size | ${fmt(b.totalSize)} | ${fmt(a.totalSize)} |`,
  ];
  for (const bc of b.categories) {
    const ac = a.categories.find((c) => c.label === bc.label);
    if (bc.count === 0 && ac.count === 0) continue;
    lines.push(`| ${bc.label} | ${bc.count} obj, ${fmt(bc.totalSize)} | ${ac.count} obj, ${fmt(ac.totalSize)} |`);
  }
  return lines.join('\n');
}

// --- Main ---

async function main() {
  console.log('Running benchmarks...\n');

  const benchmarks = [
    { name: 'Illustrator-style bloat', fn: createIllustratorStylePdf },
    { name: 'Photo-heavy (lossless)', fn: createPhotoHeavyPdf },
    { name: 'Photo-heavy (lossy q=75)', fn: createPhotoHeavyPdf, options: { lossy: true, imageQuality: 0.75 } },
    { name: 'Photo-heavy (lossy q=75, 150dpi)', fn: createPhotoHeavyPdf, options: { lossy: true, imageQuality: 0.75, maxImageDpi: 150 } },
    { name: 'Tagged accessible PDF', fn: createTaggedAccessiblePdf },
    { name: 'PDF/A-1b document', fn: createPdfA1bDocument },
    { name: 'Multi-font duplicates', fn: createMultiFontDuplicatesPdf },
    { name: 'Kitchen sink (lossless)', fn: createKitchenSinkPdf },
    { name: 'Kitchen sink (lossy q=75)', fn: createKitchenSinkPdf, options: { lossy: true, imageQuality: 0.75 } },
  ];

  const results = [];
  for (const { name, fn, options } of benchmarks) {
    process.stdout.write(`  ${name}...`);
    const result = await runBenchmark(name, fn, options);
    results.push(result);
    console.log(` ${fmt(result.inputSize)} → ${fmt(result.outputSize)} (${pct(result.savedPercent)} saved, ${result.elapsed}ms)`);
  }

  // --- Build markdown ---
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const lines = [
    `# Benchmark Results`,
    ``,
    `Generated: ${now}  `,
    `Node: ${process.version}  `,
    `Platform: ${process.platform} ${process.arch}`,
    ``,
    `## Summary`,
    ``,
    `| Benchmark | Input | Output | Saved | Time |`,
    `|-----------|-------|--------|-------|------|`,
  ];

  for (const r of results) {
    lines.push(
      `| ${r.name} | ${fmt(r.inputSize)} | ${fmt(r.outputSize)} | ${pct(r.savedPercent)} | ${r.elapsed}ms |`,
    );
  }

  lines.push('');

  // Detailed sections
  for (const r of results) {
    lines.push(`## ${r.name}`);
    lines.push('');
    lines.push(`**Input:** ${fmt(r.inputSize)} | **Output:** ${fmt(r.outputSize)} | **Saved:** ${pct(r.savedPercent)} (${fmt(r.savedBytes)}) | **Time:** ${r.elapsed}ms`);
    if (r.sizeGuard) lines.push('> Size guard activated — returned original bytes.');
    lines.push(`**Detected traits:** ${traitsLine(r.pdfTraits)}`);
    lines.push('');
    lines.push('### Pass results');
    lines.push('');
    lines.push(passTable(r.passes));
    lines.push('');
    lines.push('### Object breakdown');
    lines.push('');
    lines.push(inspectSummary(r.inspect));
    lines.push('');
  }

  const markdown = lines.join('\n');
  writeFileSync(OUTPUT_PATH, markdown, 'utf-8');
  console.log(`\nReport written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
