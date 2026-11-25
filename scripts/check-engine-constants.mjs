#!/usr/bin/env node
/**
 * Fails if numeric literals that could be statutory values appear in the payroll engine source
 * (outside __tests__). Statutory rates, bands, thresholds and schedules must come from
 * StatutoryRuleVersion.params, never from code.
 *
 * Allowed literals (minimal, structural only):
 *   0, 1, 2  — counters, off-by-one, half-up rounding
 *   100      — two-decimal quantities (hundredths) and % display of basis points
 * A line may opt out with a trailing comment `engine-constants-allow: <reason>` for
 * non-statutory calendar arithmetic (e.g. milliseconds per day, months 1–12).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src', 'lib', 'payroll-engine');
const ALLOWED = new Set(['0', '1', '2', '100']);
const ALLOW_MARKER = /engine-constants-allow:\s*\S+/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') out.push(...walk(p));
    } else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Blanks out comments, string and template literals, preserving line breaks. */
function stripNonCode(src) {
  return src.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
    (m) => m.replace(/[^\n]/g, ' '),
  );
}

const NUMBER =
  /(?<![\w$.])(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)n?(?![\w$])/g;
// Regex literals are hard to strip in general; skip numbers inside `/.../` quantifiers like {4}.
const REGEX_QUANTIFIER = /\{\d+(?:,\d*)?\}/g;

const problems = [];
for (const file of walk(ROOT)) {
  const raw = readFileSync(file, 'utf8').split(/\r?\n/);
  const code = stripNonCode(readFileSync(file, 'utf8')).split(/\r?\n/);
  code.forEach((lineText, i) => {
    if (ALLOW_MARKER.test(raw[i] ?? '')) return;
    const cleaned = lineText.replace(REGEX_QUANTIFIER, ' ');
    for (const m of cleaned.matchAll(NUMBER)) {
      const value = m[0].replace(/_/g, '').replace(/n$/, '');
      if (!ALLOWED.has(value)) {
        problems.push(`${relative(process.cwd(), file)}:${i + 1}  literal ${m[0]}`);
      }
    }
  });
}

if (problems.length) {
  console.error('Statutory-looking numeric literals found in the payroll engine:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nMove these values into StatutoryRuleVersion.params (or justify with engine-constants-allow).',
  );
  process.exit(1);
}
console.log(`check-engine-constants: OK (${walk(ROOT).length} files scanned)`);
