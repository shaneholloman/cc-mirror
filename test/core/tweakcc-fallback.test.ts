import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getProvider } from '../../src/providers/index.js';
import { TweakccStep } from '../../src/core/variant-builder/steps/TweakccStep.js';
import type { BuildContext } from '../../src/core/variant-builder/types.js';
import { cleanup, makeTempDir } from '../helpers/index.js';

test('TweakccStep continues with pristine runtime after recoverable patch failure', async () => {
  const rootDir = makeTempDir();
  const binDir = makeTempDir();
  const stubBin = makeTempDir();
  const prevPath = process.env.PATH;

  try {
    const stubName = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const stubNpx = path.join(stubBin, stubName);
    if (process.platform === 'win32') {
      fs.writeFileSync(
        stubNpx,
        '@echo off\r\necho cc-mirror validation failed: patched Claude Code binary failed --version 1>&2\r\nexit /b 1\r\n',
        { encoding: 'utf8' }
      );
    } else {
      fs.writeFileSync(
        stubNpx,
        '#!/usr/bin/env bash\necho "cc-mirror validation failed: patched Claude Code binary failed --version" >&2\nexit 1\n',
        { encoding: 'utf8', mode: 0o755 }
      );
    }

    process.env.PATH = `${stubBin}${path.delimiter}${prevPath || ''}`;

    const variantDir = path.join(rootDir, 'fallback');
    const configDir = path.join(variantDir, 'config');
    const tweakDir = path.join(variantDir, 'tweakcc');
    const nativeDir = path.join(variantDir, 'native');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(tweakDir, { recursive: true });
    fs.mkdirSync(nativeDir, { recursive: true });

    const binaryPath = path.join(nativeDir, process.platform === 'win32' ? 'claude.exe' : 'claude');
    fs.copyFileSync(process.execPath, binaryPath);
    if (process.platform !== 'win32') {
      fs.chmodSync(binaryPath, 0o755);
    }

    const provider = getProvider('minimax');
    assert.ok(provider, 'expected minimax provider');

    const ctx: BuildContext = {
      params: {
        name: 'fallback',
        providerKey: 'minimax',
        noTweak: false,
        promptPack: true,
      },
      provider,
      paths: {
        resolvedRoot: rootDir,
        resolvedBin: binDir,
        variantDir,
        configDir,
        tweakDir,
        wrapperPath: path.join(binDir, process.platform === 'win32' ? 'fallback.cmd' : 'fallback'),
        nativeDir,
      },
      prefs: {
        resolvedClaudeVersion: 'stable',
        promptPackPreference: true,
        promptPackEnabled: true,
        skillInstallEnabled: false,
        shellEnvEnabled: false,
        skillUpdateEnabled: false,
        brandKey: 'minimax',
        commandStdio: 'pipe',
      },
      state: {
        binaryPath,
        claudeBinary: 'native:test',
        notes: [],
        tweakResult: null,
      },
      report: () => {},
      isAsync: true,
    };

    await new TweakccStep().executeAsync(ctx);

    assert.equal(ctx.state.tweakResult?.status, 1);
    assert.equal(ctx.prefs.promptPackPreference, false);
    assert.equal(ctx.prefs.promptPackEnabled, false);
    assert.ok(
      ctx.state.notes.some((note) => note.includes('Continuing with pristine native runtime')),
      'expected fallback note'
    );
  } finally {
    process.env.PATH = prevPath;
    cleanup(rootDir);
    cleanup(binDir);
    cleanup(stubBin);
  }
});
