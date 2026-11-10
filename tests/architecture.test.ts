import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../src');
const CORE = join(SRC, 'core');

/** Packages the core may use. Anything else (next, react, prisma, an AI or PayPal SDK...) is a violation. */
const ALLOWED_PACKAGES = new Set(['zod']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const found: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\b(?:import|require)\(\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

const coreFiles = sourceFiles(CORE);
const label = (file: string) => relative(SRC, file).split(sep).join('/');
const moduleOf = (file: string) => relative(CORE, file).split(sep)[0]!;

describe('architecture', () => {
  it('finds the core', () => {
    expect(coreFiles.length).toBeGreaterThan(20);
  });

  it('core/ never imports from adapters/, app/ or the composition root', () => {
    const violations: string[] = [];
    for (const file of coreFiles) {
      for (const spec of importsOf(file)) {
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(file), spec);
        if (target !== CORE && !target.startsWith(CORE + sep)) violations.push(`${label(file)} -> ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('core/ imports no framework, database, AI or PayPal package', () => {
    const violations: string[] = [];
    for (const file of coreFiles) {
      for (const spec of importsOf(file)) {
        if (spec.startsWith('.')) continue;
        if (spec.startsWith('@/')) {
          violations.push(`${label(file)} -> ${spec} (use relative imports inside core)`);
          continue;
        }
        const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
        if (!ALLOWED_PACKAGES.has(pkg)) violations.push(`${label(file)} -> ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('a core module imports only from itself and core/shared', () => {
    const violations: string[] = [];
    for (const file of coreFiles) {
      const own = moduleOf(file);
      for (const spec of importsOf(file)) {
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(file), spec);
        if (!target.startsWith(CORE + sep)) continue; // reported by the test above
        const targetModule = relative(CORE, target).split(sep)[0]!;
        if (targetModule !== own && targetModule !== 'shared') violations.push(`${label(file)} -> ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('code outside core/ reaches a module only through its index.ts', () => {
    const outside = sourceFiles(SRC).filter((file) => !file.startsWith(CORE + sep));
    const violations: string[] = [];
    for (const file of outside) {
      for (const spec of importsOf(file)) {
        const target = spec.startsWith('@/')
          ? resolve(SRC, spec.slice(2))
          : spec.startsWith('.')
            ? resolve(dirname(file), spec)
            : null;
        if (!target || !target.startsWith(CORE + sep)) continue;
        const parts = relative(CORE, target).split(sep);
        const deep = parts.length > 2 || (parts.length === 2 && parts[1] !== 'index');
        if (deep) violations.push(`${label(file)} -> ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
