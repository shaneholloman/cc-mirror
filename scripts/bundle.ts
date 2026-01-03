import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');

fs.mkdirSync(distDir, { recursive: true });

// Keep React ecosystem as external (npm will install them)
// This avoids bundling issues with dynamic imports and optional deps
const external = [
  // React ecosystem - let npm handle these
  'react',
  'react-dom',
  'ink',
  'ink-big-text',
  'ink-box',
  'ink-gradient',
  'ink-select-input',
  'ink-spinner',
  'ink-text-input',
  // Other dependencies
  'gradient-string',
  'tweakcc',
];

// Build CLI
await build({
  entryPoints: [path.join(root, 'src', 'cli', 'index.ts')],
  outfile: path.join(distDir, 'cc-mirror.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  external,
  banner: {
    js: '#!/usr/bin/env node',
  },
});

// Build TUI
await build({
  entryPoints: [path.join(root, 'src', 'tui', 'index.tsx')],
  outfile: path.join(distDir, 'tui.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  external,
});

fs.chmodSync(path.join(distDir, 'cc-mirror.mjs'), 0o755);

console.log('Bundled to dist/cc-mirror.mjs and dist/tui.mjs');
