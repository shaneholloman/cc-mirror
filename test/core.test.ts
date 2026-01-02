import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../src/core/index.js';

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mirror-test-'));

const writeExecutable = (filePath: string, content: string) => {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
};

const readFile = (filePath: string) => fs.readFileSync(filePath, 'utf8');

const cleanup = (dir: string) => {
  fs.rmSync(dir, { recursive: true, force: true });
};

const resolveNpmCliPath = (npmDir: string, npmPackage: string) =>
  path.join(npmDir, 'node_modules', ...npmPackage.split('/'), 'cli.js');

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
const payload = process.env.CC_MIRROR_FAKE_NPM_PAYLOAD || 'claude dummy';
fs.writeFileSync(cliPath, '#!/usr/bin/env node\\n' + 'console.log(' + JSON.stringify(payload) + ');\\n');
fs.chmodSync(cliPath, 0o755);
`;
  writeExecutable(npmPath, script);
  return npmPath;
};

const withFakeNpm = (fn: () => void) => {
  const binDir = makeTempDir();
  createFakeNpm(binDir);
  const previousPath = process.env.PATH || '';
  process.env.PATH = `${binDir}:${previousPath}`;
  try {
    fn();
  } finally {
    process.env.PATH = previousPath;
    delete process.env.CC_MIRROR_FAKE_NPM_PAYLOAD;
    cleanup(binDir);
  }
};

test('core create/update/remove/doctor flows', () => {
  withFakeNpm(() => {
    process.env.CC_MIRROR_FAKE_NPM_PAYLOAD = 'claude dummy';
    const rootDir = makeTempDir();
    const binDir = makeTempDir();

    const result = core.createVariant({
      name: 'alpha',
      providerKey: 'custom',
      baseUrl: 'http://localhost:4000/anthropic',
      apiKey: '',
      extraEnv: ['FOO=bar'],
      rootDir,
      binDir,
      noTweak: true,
      tweakccStdio: 'pipe',
    });

    const variantDir = path.join(rootDir, 'alpha');
    const npmDir = path.join(variantDir, 'npm');
    const binaryPath = resolveNpmCliPath(npmDir, core.DEFAULT_NPM_PACKAGE);
    const configPath = path.join(variantDir, 'config', 'settings.json');
    const wrapperPath = path.join(binDir, 'alpha');
    const variantMetaPath = path.join(variantDir, 'variant.json');

    assert.ok(fs.existsSync(binaryPath));
    assert.ok(fs.existsSync(configPath));
    assert.ok(fs.existsSync(wrapperPath));
    assert.ok(fs.existsSync(variantMetaPath));
    assert.equal(result.wrapperPath, wrapperPath);

    const configJson = JSON.parse(readFile(configPath)) as { env: Record<string, string> };
    assert.equal(configJson.env.ANTHROPIC_BASE_URL, 'http://localhost:4000/anthropic');
    assert.equal(configJson.env.FOO, 'bar');
    assert.equal(configJson.env.ANTHROPIC_API_KEY, '<API_KEY>');
    assert.equal(configJson.env.DISABLE_AUTOUPDATER, '1');
    assert.equal(configJson.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION, '1');

    process.env.CC_MIRROR_FAKE_NPM_PAYLOAD = 'claude new';
    core.updateVariant(rootDir, 'alpha', { noTweak: true, tweakccStdio: 'pipe' });
    assert.equal(readFile(binaryPath).includes('claude new'), true);

    const doctorReport = core.doctor(rootDir, binDir);
    assert.equal(doctorReport.length, 1);
    assert.equal(doctorReport[0].ok, true);

    core.removeVariant(rootDir, 'alpha');
    assert.equal(fs.existsSync(variantDir), false);

    cleanup(rootDir);
    cleanup(binDir);
  });
});

test('zai brand preset writes tweakcc config', () => {
  withFakeNpm(() => {
    const rootDir = makeTempDir();
    const binDir = makeTempDir();

    core.createVariant({
      name: 'zai',
      providerKey: 'zai',
      apiKey: '',
      rootDir,
      binDir,
      brand: 'zai',
      promptPack: false,
      skillInstall: false,
      noTweak: true,
      tweakccStdio: 'pipe',
    });

    const tweakConfigPath = path.join(rootDir, 'zai', 'tweakcc', 'config.json');
    assert.ok(fs.existsSync(tweakConfigPath));
    const tweakConfig = JSON.parse(readFile(tweakConfigPath)) as { settings?: { themes?: { id?: string }[] } };
    assert.equal(tweakConfig.settings?.themes?.[0]?.id, 'zai-carbon');

    cleanup(rootDir);
    cleanup(binDir);
  });
});

test('minimax brand preset writes tweakcc config', () => {
  withFakeNpm(() => {
    const rootDir = makeTempDir();
    const binDir = makeTempDir();

    core.createVariant({
      name: 'minimax',
      providerKey: 'minimax',
      apiKey: '',
      rootDir,
      binDir,
      brand: 'minimax',
      promptPack: false,
      skillInstall: false,
      noTweak: true,
      tweakccStdio: 'pipe',
    });

    const tweakConfigPath = path.join(rootDir, 'minimax', 'tweakcc', 'config.json');
    assert.ok(fs.existsSync(tweakConfigPath));
    const tweakConfig = JSON.parse(readFile(tweakConfigPath)) as { settings?: { themes?: { id?: string }[] } };
    const themeIds = tweakConfig.settings?.themes?.map(theme => theme?.id) ?? [];
    assert.equal(themeIds[0], 'minimax-pulse');
    assert.equal(themeIds.includes('minimax-glass'), false);
    assert.equal(themeIds.includes('minimax-blade'), false);
    assert.equal(themeIds.includes('minimax-ember'), false);

    const claudeConfigPath = path.join(rootDir, 'minimax', 'config', '.claude.json');
    assert.ok(fs.existsSync(claudeConfigPath));
    const claudeConfig = JSON.parse(readFile(claudeConfigPath)) as {
      mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }>;
    };
    const minimaxServer = claudeConfig.mcpServers?.MiniMax;
    assert.ok(minimaxServer);
    assert.equal(minimaxServer?.command, 'uvx');
    assert.deepEqual(minimaxServer?.args, ['minimax-coding-plan-mcp', '-y']);

    cleanup(rootDir);
    cleanup(binDir);
  });
});

test('openrouter brand preset writes tweakcc config', () => {
  withFakeNpm(() => {
    const rootDir = makeTempDir();
    const binDir = makeTempDir();

    core.createVariant({
      name: 'openrouter',
      providerKey: 'openrouter',
      apiKey: 'or-key',
      rootDir,
      binDir,
      brand: 'openrouter',
      promptPack: false,
      skillInstall: false,
      noTweak: true,
      tweakccStdio: 'pipe',
    });

    const tweakConfigPath = path.join(rootDir, 'openrouter', 'tweakcc', 'config.json');
    assert.ok(fs.existsSync(tweakConfigPath));
    const tweakConfig = JSON.parse(readFile(tweakConfigPath)) as { settings?: { themes?: { id?: string }[] } };
    assert.equal(tweakConfig.settings?.themes?.[0]?.id, 'openrouter-slate');

    cleanup(rootDir);
    cleanup(binDir);
  });
});

test('litellm brand preset writes tweakcc config', () => {
  withFakeNpm(() => {
    const rootDir = makeTempDir();
    const binDir = makeTempDir();

    core.createVariant({
      name: 'litellm',
      providerKey: 'litellm',
      apiKey: '',
      rootDir,
      binDir,
      brand: 'litellm',
      promptPack: false,
      skillInstall: false,
      noTweak: true,
      tweakccStdio: 'pipe',
    });

    const tweakConfigPath = path.join(rootDir, 'litellm', 'tweakcc', 'config.json');
    assert.ok(fs.existsSync(tweakConfigPath));
    const tweakConfig = JSON.parse(readFile(tweakConfigPath)) as { settings?: { themes?: { id?: string }[] } };
    assert.equal(tweakConfig.settings?.themes?.[0]?.id, 'litellm-sky');

    cleanup(rootDir);
    cleanup(binDir);
  });
});

test('api key approvals are written to .claude.json', () => {
  withFakeNpm(() => {
    const rootDir = makeTempDir();
    const binDir = makeTempDir();

    const apiKey = 'sk-test-1234567890abcdefghijklmnopqrstuvwxyz';

    core.createVariant({
      name: 'beta',
      providerKey: 'custom',
      baseUrl: 'http://localhost:4000/anthropic',
      apiKey,
      rootDir,
      binDir,
      noTweak: true,
      tweakccStdio: 'pipe',
    });

    const claudeConfigPath = path.join(rootDir, 'beta', 'config', '.claude.json');
    assert.ok(fs.existsSync(claudeConfigPath));
    const config = JSON.parse(readFile(claudeConfigPath)) as {
      customApiKeyResponses?: { approved?: string[] };
    };
    const approved = config.customApiKeyResponses?.approved ?? [];
    assert.ok(approved.includes(apiKey.slice(-20)));

    cleanup(rootDir);
    cleanup(binDir);
  });
});
