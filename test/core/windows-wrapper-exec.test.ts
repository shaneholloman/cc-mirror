/**
 * Windows wrapper execution smoke test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as core from '../../src/core/index.js';
import { getWrapperPath } from '../../src/core/paths.js';
import { makeTempDir, cleanup } from '../helpers/index.js';

test('windows wrapper executes CLI', { skip: process.platform !== 'win32' }, () => {
  const rootDir = makeTempDir();
  const binDir = makeTempDir();

  try {
    return (async () => {
      const result = await core.createVariantAsync({
        name: 'win-smoke',
        providerKey: 'custom',
        baseUrl: 'http://localhost:4000/anthropic',
        apiKey: '',
        claudeVersion: 'stable',
        rootDir,
        binDir,
        noTweak: true,
        promptPack: false,
        skillInstall: false,
        tweakccStdio: 'pipe',
      });

      const wrapperPath = getWrapperPath(binDir, result.meta.name);
      const hiddenVersion = spawnSync(wrapperPath, ['--version'], {
        encoding: 'utf8',
        shell: true,
        env: { ...process.env, CC_MIRROR_SPLASH: '0' },
      });

      assert.equal(hiddenVersion.status, 0);
      const hiddenOutput = `${hiddenVersion.stdout ?? ''}${hiddenVersion.stderr ?? ''}`;
      assert.match(hiddenOutput, /cc-mirror/i);
      assert.doesNotMatch(hiddenOutput, /\d+\.\d+\.\d+/, 'Expected default --version output to hide native semver');

      const nativeVersion = spawnSync(wrapperPath, ['--version'], {
        encoding: 'utf8',
        shell: true,
        env: { ...process.env, CC_MIRROR_SHOW_NATIVE_VERSION: '1', CC_MIRROR_SPLASH: '0' },
      });

      assert.equal(nativeVersion.status, 0);
      const nativeOutput = `${nativeVersion.stdout ?? ''}${nativeVersion.stderr ?? ''}`;
      assert.match(nativeOutput, /\d+\.\d+\.\d+/, 'Expected opt-in --version output to include a native semver');
    })();
  } finally {
    cleanup(rootDir);
    cleanup(binDir);
  }
});
