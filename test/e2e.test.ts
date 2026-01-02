/**
 * End-to-End Tests for cc-mirror
 *
 * These tests create actual variants using temp directories and verify:
 * - All 4 providers work correctly (zai, minimax, openrouter, litellm)
 * - Wrapper scripts are created with correct content
 * - Configuration files are written correctly
 * - Brand themes are applied
 * - Colored ASCII art is included in wrappers
 * - Cleanup works correctly
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../src/core/index.js';

// Test utilities
const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mirror-e2e-'));

const writeExecutable = (filePath: string, content: string) => {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
};

const readFile = (filePath: string) => fs.readFileSync(filePath, 'utf8');

const cleanup = (dir: string) => {
  fs.rmSync(dir, { recursive: true, force: true });
};

// Create a fake npm that creates a dummy cli.js
const createFakeNpm = (dir: string) => {
  const npmPath = path.join(dir, 'npm');
  const script = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let prefix = '';
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--prefix' && args[i + 1]) {
    prefix = args[i + 1];
  }
}
if (!prefix) process.exit(1);
const pkgSpec = args[args.length - 1] || '@anthropic-ai/claude-code';
const atIndex = pkgSpec.lastIndexOf('@');
const pkgName = atIndex > 0 ? pkgSpec.slice(0, atIndex) : pkgSpec;
const cliPath = path.join(prefix, 'node_modules', ...pkgName.split('/'), 'cli.js');
fs.mkdirSync(path.dirname(cliPath), { recursive: true });
fs.writeFileSync(cliPath, '#!/usr/bin/env node\\nconsole.log("Claude Code stub");\\n');
fs.chmodSync(cliPath, 0o755);
`;
  writeExecutable(npmPath, script);
  return npmPath;
};

// Wrapper to set up fake npm in PATH
const withFakeNpm = (fn: () => void) => {
  const binDir = makeTempDir();
  createFakeNpm(binDir);
  const previousPath = process.env.PATH || '';
  process.env.PATH = `${binDir}:${previousPath}`;
  try {
    fn();
  } finally {
    process.env.PATH = previousPath;
    cleanup(binDir);
  }
};

// Provider test configurations
const PROVIDERS = [
  {
    key: 'zai',
    name: 'Zai Cloud',
    apiKey: 'test-zai-key',
    expectedThemeId: 'zai-carbon',
    expectedSplashStyle: 'zai',
    colorCode: '\\x1b[38;5;220m', // Gold
  },
  {
    key: 'minimax',
    name: 'MiniMax Cloud',
    apiKey: 'test-minimax-key',
    expectedThemeId: 'minimax-pulse',
    expectedSplashStyle: 'minimax',
    colorCode: '\\x1b[38;5;135m', // Purple
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    apiKey: 'test-openrouter-key',
    expectedThemeId: 'openrouter-slate',
    expectedSplashStyle: 'openrouter',
    colorCode: '\\x1b[38;5;43m', // Teal
  },
  {
    key: 'litellm',
    name: 'LiteLLM',
    apiKey: '', // Optional for litellm
    expectedThemeId: 'litellm-sky',
    expectedSplashStyle: 'litellm',
    colorCode: '\\x1b[38;5;39m', // Sky blue
  },
];

test('E2E: Create variants for all providers', async (t) => {
  const createdDirs: string[] = [];

  t.after(() => {
    // Cleanup all created directories
    for (const dir of createdDirs) {
      cleanup(dir);
    }
  });

  await t.test('creates all 4 provider variants with correct configuration', () => {
    withFakeNpm(() => {
      for (const provider of PROVIDERS) {
        const rootDir = makeTempDir();
        const binDir = makeTempDir();
        createdDirs.push(rootDir, binDir);

        const result = core.createVariant({
          name: provider.key,
          providerKey: provider.key,
          apiKey: provider.apiKey,
          rootDir,
          binDir,
          brand: provider.key,
          promptPack: false,
          skillInstall: false,
          noTweak: true,
          tweakccStdio: 'pipe',
        });

        // Verify variant was created
        const variantDir = path.join(rootDir, provider.key);
        assert.ok(fs.existsSync(variantDir), `${provider.name} variant dir should exist`);

        // Verify wrapper was created
        const wrapperPath = path.join(binDir, provider.key);
        assert.ok(fs.existsSync(wrapperPath), `${provider.name} wrapper should exist`);
        assert.equal(result.wrapperPath, wrapperPath);

        // Verify settings.json was created with correct provider config
        const configPath = path.join(variantDir, 'config', 'settings.json');
        assert.ok(fs.existsSync(configPath), `${provider.name} settings.json should exist`);
        const config = JSON.parse(readFile(configPath)) as { env: Record<string, string> };
        assert.ok(config.env, `${provider.name} should have env section`);

        // Verify tweakcc config has correct theme
        const tweakConfigPath = path.join(variantDir, 'tweakcc', 'config.json');
        assert.ok(fs.existsSync(tweakConfigPath), `${provider.name} tweakcc config should exist`);
        const tweakConfig = JSON.parse(readFile(tweakConfigPath)) as {
          settings?: { themes?: { id?: string }[] };
        };
        assert.equal(
          tweakConfig.settings?.themes?.[0]?.id,
          provider.expectedThemeId,
          `${provider.name} should have correct theme ID`
        );
      }
    });
  });

  await t.test('wrapper scripts contain colored ASCII art', () => {
    withFakeNpm(() => {
      for (const provider of PROVIDERS) {
        const rootDir = makeTempDir();
        const binDir = makeTempDir();
        createdDirs.push(rootDir, binDir);

        core.createVariant({
          name: `${provider.key}-art`,
          providerKey: provider.key,
          apiKey: provider.apiKey,
          rootDir,
          binDir,
          brand: provider.key,
          promptPack: false,
          skillInstall: false,
          noTweak: true,
          tweakccStdio: 'pipe',
        });

        const wrapperPath = path.join(binDir, `${provider.key}-art`);
        const wrapperContent = readFile(wrapperPath);

        // Verify ANSI color codes are present (escape character \x1b)
        assert.ok(
          wrapperContent.includes('\x1b[38;5;'),
          `${provider.name} wrapper should contain ANSI color codes`
        );

        // Verify the case statement includes the provider's splash style
        assert.ok(
          wrapperContent.includes(`${provider.expectedSplashStyle})`),
          `${provider.name} wrapper should have case for splash style`
        );

        // Verify reset code is present
        assert.ok(
          wrapperContent.includes('\x1b[0m'),
          `${provider.name} wrapper should contain color reset code`
        );

        // Verify CC_MIRROR_SPLASH_STYLE env var is read
        assert.ok(
          wrapperContent.includes('CC_MIRROR_SPLASH_STYLE'),
          `${provider.name} wrapper should reference CC_MIRROR_SPLASH_STYLE`
        );
      }
    });
  });

  await t.test('variant.json metadata is created correctly', () => {
    withFakeNpm(() => {
      for (const provider of PROVIDERS) {
        const rootDir = makeTempDir();
        const binDir = makeTempDir();
        createdDirs.push(rootDir, binDir);

        core.createVariant({
          name: `${provider.key}-meta`,
          providerKey: provider.key,
          apiKey: provider.apiKey,
          rootDir,
          binDir,
          brand: provider.key,
          promptPack: false,
          skillInstall: false,
          noTweak: true,
          tweakccStdio: 'pipe',
        });

        const variantMetaPath = path.join(rootDir, `${provider.key}-meta`, 'variant.json');
        assert.ok(fs.existsSync(variantMetaPath), `${provider.name} variant.json should exist`);

        const meta = JSON.parse(readFile(variantMetaPath)) as {
          name: string;
          provider: string;
          createdAt: string;
        };
        assert.equal(meta.name, `${provider.key}-meta`);
        assert.equal(meta.provider, provider.key);
        assert.ok(meta.createdAt, 'createdAt should be set');
      }
    });
  });
});

test('E2E: Update and remove variants', async (t) => {
  const createdDirs: string[] = [];

  t.after(() => {
    for (const dir of createdDirs) {
      cleanup(dir);
    }
  });

  await t.test('can update a variant', () => {
    withFakeNpm(() => {
      const rootDir = makeTempDir();
      const binDir = makeTempDir();
      createdDirs.push(rootDir, binDir);

      // Create variant
      core.createVariant({
        name: 'update-test',
        providerKey: 'zai',
        apiKey: 'test-key',
        rootDir,
        binDir,
        brand: 'zai',
        promptPack: false,
        skillInstall: false,
        noTweak: true,
        tweakccStdio: 'pipe',
      });

      // Update variant
      const updateResult = core.updateVariant(rootDir, 'update-test', {
        noTweak: true,
        tweakccStdio: 'pipe',
        binDir,
      });

      assert.ok(updateResult.meta, 'Update should return meta');
      assert.equal(updateResult.meta.name, 'update-test');

      // Verify variant still exists
      const variantDir = path.join(rootDir, 'update-test');
      assert.ok(fs.existsSync(variantDir), 'Variant should still exist after update');
    });
  });

  await t.test('can remove a variant', () => {
    withFakeNpm(() => {
      const rootDir = makeTempDir();
      const binDir = makeTempDir();
      createdDirs.push(rootDir, binDir);

      // Create variant
      core.createVariant({
        name: 'remove-test',
        providerKey: 'minimax',
        apiKey: 'test-key',
        rootDir,
        binDir,
        brand: 'minimax',
        promptPack: false,
        skillInstall: false,
        noTweak: true,
        tweakccStdio: 'pipe',
      });

      const variantDir = path.join(rootDir, 'remove-test');
      assert.ok(fs.existsSync(variantDir), 'Variant should exist before removal');

      // Remove variant
      core.removeVariant(rootDir, 'remove-test');

      assert.ok(!fs.existsSync(variantDir), 'Variant should not exist after removal');
    });
  });
});

test('E2E: Doctor command', async (t) => {
  const createdDirs: string[] = [];

  t.after(() => {
    for (const dir of createdDirs) {
      cleanup(dir);
    }
  });

  await t.test('doctor reports healthy variants', () => {
    withFakeNpm(() => {
      const rootDir = makeTempDir();
      const binDir = makeTempDir();
      createdDirs.push(rootDir, binDir);

      // Create multiple variants
      for (const provider of ['zai', 'minimax']) {
        core.createVariant({
          name: `doctor-${provider}`,
          providerKey: provider,
          apiKey: 'test-key',
          rootDir,
          binDir,
          brand: provider,
          promptPack: false,
          skillInstall: false,
          noTweak: true,
          tweakccStdio: 'pipe',
        });
      }

      // Run doctor
      const report = core.doctor(rootDir, binDir);

      assert.equal(report.length, 2, 'Doctor should report 2 variants');
      for (const entry of report) {
        assert.ok(entry.ok, `Variant ${entry.name} should be healthy`);
      }
    });
  });
});

test('E2E: List variants', async (t) => {
  const createdDirs: string[] = [];

  t.after(() => {
    for (const dir of createdDirs) {
      cleanup(dir);
    }
  });

  await t.test('lists all created variants', () => {
    withFakeNpm(() => {
      const rootDir = makeTempDir();
      const binDir = makeTempDir();
      createdDirs.push(rootDir, binDir);

      // Create variants for all providers
      for (const provider of PROVIDERS) {
        core.createVariant({
          name: `list-${provider.key}`,
          providerKey: provider.key,
          apiKey: provider.apiKey,
          rootDir,
          binDir,
          brand: provider.key,
          promptPack: false,
          skillInstall: false,
          noTweak: true,
          tweakccStdio: 'pipe',
        });
      }

      const variants = core.listVariants(rootDir);

      assert.equal(variants.length, PROVIDERS.length, `Should list ${PROVIDERS.length} variants`);

      const variantNames = variants.map((v) => v.name);
      for (const provider of PROVIDERS) {
        assert.ok(
          variantNames.includes(`list-${provider.key}`),
          `Should include list-${provider.key}`
        );
      }
    });
  });
});

test('E2E: Colored ASCII art content verification', async (t) => {
  const createdDirs: string[] = [];

  t.after(() => {
    for (const dir of createdDirs) {
      cleanup(dir);
    }
  });

  await t.test('each provider has distinct color scheme in wrapper', () => {
    withFakeNpm(() => {
      const rootDir = makeTempDir();
      const binDir = makeTempDir();
      createdDirs.push(rootDir, binDir);

      // Create all providers
      const wrapperContents: Map<string, string> = new Map();

      for (const provider of PROVIDERS) {
        core.createVariant({
          name: `color-${provider.key}`,
          providerKey: provider.key,
          apiKey: provider.apiKey,
          rootDir,
          binDir,
          brand: provider.key,
          promptPack: false,
          skillInstall: false,
          noTweak: true,
          tweakccStdio: 'pipe',
        });

        const wrapperPath = path.join(binDir, `color-${provider.key}`);
        wrapperContents.set(provider.key, readFile(wrapperPath));
      }

      // Verify each provider has its specific color
      const colorPatterns: Record<string, RegExp> = {
        zai: /\x1b\[38;5;220m/, // Gold
        minimax: /\x1b\[38;5;135m/, // Purple
        openrouter: /\x1b\[38;5;43m/, // Teal
        litellm: /\x1b\[38;5;39m/, // Sky blue
      };

      for (const [providerKey, pattern] of Object.entries(colorPatterns)) {
        const content = wrapperContents.get(providerKey);
        assert.ok(content, `Should have content for ${providerKey}`);
        assert.ok(
          pattern.test(content!),
          `${providerKey} should have its specific primary color`
        );
      }

      // Verify ASCII art text content - check for taglines and block patterns
      const asciiPatterns: Record<string, string[]> = {
        zai: ['███████╗', 'GLM Coding Plan'],
        minimax: ['███╗   ███╗', 'MiniMax-M2.1', 'AGI for All'],
        openrouter: ['██████╗ ██████╗', 'One API', 'Any Model'],
        litellm: ['██╗     ██╗████████╗', 'Local LLMs', 'Any Backend'],
      };

      for (const [providerKey, patterns] of Object.entries(asciiPatterns)) {
        const content = wrapperContents.get(providerKey);
        for (const pattern of patterns) {
          assert.ok(
            content!.includes(pattern),
            `${providerKey} should include "${pattern}" in ASCII art`
          );
        }
      }
    });
  });
});
