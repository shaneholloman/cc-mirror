import fs from 'node:fs';
import path from 'node:path';
import { getBrandThemeId, resolveBrandKey } from '../brands/index.js';
import { buildEnv, getProvider } from '../providers/index.js';
import { DEFAULT_BIN_DIR, DEFAULT_NPM_PACKAGE, DEFAULT_NPM_VERSION, DEFAULT_ROOT } from './constants.js';
import { ensureDir, writeJson } from './fs.js';
import { installNpmClaude } from './install.js';
import { expandTilde } from './paths.js';
import {
  ensureApiKeyApproval,
  ensureMinimaxMcpServer,
  ensureOnboardingState,
  ensureSettingsEnvDefaults,
  ensureSettingsEnvOverrides,
  ensureZaiMcpDeny,
} from './claude-config.js';
import { applyPromptPack } from './prompt-pack.js';
import { ensureZaiShellEnv } from './shell-env.js';
import { ensureDevBrowserSkill } from './skills.js';
import { ensureTweakccConfig, launchTweakccUi, runTweakcc } from './tweakcc.js';
import { formatTweakccFailure } from './errors.js';
import { listVariants as listVariantsImpl, loadVariantMeta } from './variants.js';
import { writeWrapper } from './wrapper.js';
import type {
  CreateVariantParams,
  CreateVariantResult,
  DoctorReportItem,
  UpdateVariantOptions,
  UpdateVariantResult,
  VariantConfig,
  VariantMeta,
  VariantEntry,
} from './types.js';

export { DEFAULT_ROOT, DEFAULT_BIN_DIR, DEFAULT_NPM_PACKAGE, DEFAULT_NPM_VERSION };
export { expandTilde } from './paths.js';

const normalizeNpmPackage = (value?: string) =>
  value && value.trim().length > 0 ? value.trim() : DEFAULT_NPM_PACKAGE;

const normalizeNpmVersion = () => DEFAULT_NPM_VERSION;

const shouldEnablePromptPack = (providerKey: string) => providerKey === 'zai' || providerKey === 'minimax';

const defaultPromptPackMode = (providerKey: string): 'minimal' | 'maximal' =>
  providerKey === 'zai' || providerKey === 'minimax' ? 'maximal' : 'minimal';

const shouldInstallSkills = (providerKey: string) => providerKey === 'zai' || providerKey === 'minimax';

const shouldEnableShellEnv = (providerKey: string) => providerKey === 'zai';

export const createVariant = (params: CreateVariantParams): CreateVariantResult => {
  const {
    name,
    providerKey,
    baseUrl,
    apiKey,
    extraEnv,
    modelOverrides,
    rootDir = DEFAULT_ROOT,
    binDir = DEFAULT_BIN_DIR,
    npmPackage,
    brand,
    noTweak,
    promptPack,
    promptPackMode,
    skillInstall,
    shellEnv,
    skillUpdate,
    tweakccStdio = 'inherit',
    onProgress,
  } = params;

  const report = (step: string) => onProgress?.(step);

  const provider = getProvider(providerKey);
  if (!provider) throw new Error(`Unknown provider: ${providerKey}`);
  if (!name) throw new Error('Variant name is required');

  report('Preparing directories...');
  const resolvedRoot = expandTilde(rootDir) ?? rootDir;
  const resolvedBin = expandTilde(binDir) ?? binDir;

  const variantDir = path.join(resolvedRoot, name);
  const configDir = path.join(variantDir, 'config');
  const tweakDir = path.join(variantDir, 'tweakcc');
  const wrapperPath = path.join(resolvedBin, name);

  ensureDir(variantDir);
  ensureDir(configDir);
  ensureDir(tweakDir);
  ensureDir(resolvedBin);

  const resolvedNpmPackage = normalizeNpmPackage(npmPackage);
  const resolvedNpmVersion = normalizeNpmVersion();
  const promptPackPreference = promptPack ?? shouldEnablePromptPack(providerKey);
  const promptPackModePreference = promptPackMode ?? defaultPromptPackMode(providerKey);
  const promptPackEnabled = !noTweak && promptPackPreference;
  const skillInstallEnabled = skillInstall ?? shouldInstallSkills(providerKey);
  const shellEnvEnabled = shellEnv ?? shouldEnableShellEnv(providerKey);
  const skillUpdateEnabled = Boolean(skillUpdate);

  let binaryPath = '';
  let npmDir: string | undefined;
  let claudeBinary = '';

  report(`Installing ${resolvedNpmPackage}@${resolvedNpmVersion}...`);
  npmDir = path.join(variantDir, 'npm');
  ensureDir(npmDir);
  const install = installNpmClaude({
    npmDir,
    npmPackage: resolvedNpmPackage,
    npmVersion: resolvedNpmVersion,
    stdio: tweakccStdio,
  });
  binaryPath = install.cliPath;
  claudeBinary = `npm:${resolvedNpmPackage}@${resolvedNpmVersion}`;

  report('Writing configuration...');
  const env = buildEnv({ providerKey, baseUrl, apiKey, extraEnv, modelOverrides });
  if (!Object.hasOwn(env, 'TWEAKCC_CONFIG_DIR')) {
    env.TWEAKCC_CONFIG_DIR = tweakDir;
  }
  const authMode = provider.authMode ?? 'apiKey';
  if (authMode === 'apiKey' && !env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = '<API_KEY>';
  }
  const config: VariantConfig = { env };
  writeJson(path.join(configDir, 'settings.json'), config);
  const resolvedApiKey = typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY : undefined;
  ensureApiKeyApproval(configDir, resolvedApiKey);
  const notes: string[] = [];

  if (provider.authMode === 'authToken' && !env.ANTHROPIC_AUTH_TOKEN) {
    notes.push('ANTHROPIC_AUTH_TOKEN not set; provider auth may fail.');
  }

  if (providerKey === 'litellm' && env.ANTHROPIC_AUTH_TOKEN === 'litellm-proxy') {
    notes.push('LiteLLM auth token set to placeholder (litellm-proxy).');
  }

  if (providerKey === 'openrouter' || providerKey === 'litellm') {
    const missing: string[] = [];
    if (!env.ANTHROPIC_DEFAULT_SONNET_MODEL) missing.push('ANTHROPIC_DEFAULT_SONNET_MODEL');
    if (!env.ANTHROPIC_DEFAULT_OPUS_MODEL) missing.push('ANTHROPIC_DEFAULT_OPUS_MODEL');
    if (!env.ANTHROPIC_DEFAULT_HAIKU_MODEL) missing.push('ANTHROPIC_DEFAULT_HAIKU_MODEL');
    if (missing.length > 0) {
      notes.push(`Model mapping incomplete; add ${missing.join(', ')} if needed.`);
    }
    notes.push('Feature support varies by provider. WebSearch/Image tools may require special models.');
  }

  report('Setting up brand theme...');
  const brandKey = resolveBrandKey(providerKey, brand);
  ensureTweakccConfig(tweakDir, brandKey);

  const brandThemeId = !noTweak && brandKey ? getBrandThemeId(brandKey) : null;
  const onboarding = ensureOnboardingState(configDir, {
    themeId: brandThemeId ?? 'dark',
    forceTheme: Boolean(brandThemeId),
  });
  if (onboarding.themeChanged) {
    notes.push(`Default theme set to ${brandThemeId ?? 'dark'}.`);
  }
  if (onboarding.onboardingChanged) {
    notes.push('Onboarding marked complete.');
  }

  if (providerKey === 'minimax') {
    report('Configuring MiniMax MCP server...');
    ensureMinimaxMcpServer(configDir, resolvedApiKey);
  }
  const blockedZaiTools = providerKey === 'zai' ? ensureZaiMcpDeny(configDir) : false;
  if (blockedZaiTools) {
    notes.push('Blocked Z.ai-injected MCP tools in settings.json.');
  }
  if (noTweak && promptPackPreference) {
    notes.push(`Prompt pack skipped (tweakcc disabled, ${promptPackModePreference}).`);
  }
  let tweakResult: CreateVariantResult['tweakResult'] = null;
  if (!noTweak) {
    report('Running tweakcc patches...');
    tweakResult = runTweakcc(tweakDir, binaryPath, tweakccStdio);
    if (tweakResult.status !== 0) {
      const output = `${tweakResult.stderr ?? ''}\n${tweakResult.stdout ?? ''}`.trim();
      throw new Error(formatTweakccFailure(output));
    }

    if (promptPackEnabled) {
      report(`Applying prompt pack (${promptPackModePreference})...`);
      const packResult = applyPromptPack(tweakDir, providerKey, promptPackModePreference);
      if (packResult.changed) {
        notes.push(`Prompt pack applied (${packResult.mode}, ${packResult.updated.join(', ')})`);
        report('Re-applying tweakcc...');
        const reapply = runTweakcc(tweakDir, binaryPath, tweakccStdio);
        tweakResult = reapply;
        if (reapply.status !== 0) {
          const output = `${reapply.stderr ?? ''}\n${reapply.stdout ?? ''}`.trim();
          throw new Error(formatTweakccFailure(output));
        }
      }
    }
  }

  report('Writing CLI wrapper...');
  writeWrapper(wrapperPath, configDir, binaryPath, 'node');

  if (shellEnvEnabled && providerKey === 'zai') {
    report('Configuring shell environment...');
    const shellResult = ensureZaiShellEnv({ apiKey: resolvedApiKey ?? null, configDir });
    if (shellResult.status === 'updated') {
      const suffix = shellResult.message ? ` (${shellResult.message})` : '';
      notes.push(`Z_AI_API_KEY written to ${shellResult.path}${suffix}`);
    } else if (shellResult.status === 'failed') {
      notes.push(`Z_AI_API_KEY not written: ${shellResult.message || 'unknown error'}`);
    } else if (shellResult.message) {
      notes.push(`Z_AI_API_KEY: ${shellResult.message}`);
    }
  } else if (providerKey === 'zai') {
    notes.push('Z_AI_API_KEY not written to shell profile. Set it manually in your shell rc file.');
  }

  if (skillInstallEnabled) {
    report('Installing dev-browser skill...');
    const skillResult = ensureDevBrowserSkill({
      install: true,
      update: skillUpdateEnabled,
      targetDir: path.join(configDir, 'skills'),
    });
    if (skillResult.status === 'failed') {
      notes.push(`dev-browser skill install failed: ${skillResult.message || 'unknown error'}`);
    } else if (skillResult.status !== 'skipped') {
      notes.push(`dev-browser skill ${skillResult.status}`);
    }
  }

  report('Finalizing variant...');
  const meta: VariantMeta = {
    name,
    provider: providerKey,
    baseUrl,
    createdAt: new Date().toISOString(),
    claudeOrig: claudeBinary,
    binaryPath,
    configDir,
    tweakDir,
    brand: brandKey ?? undefined,
    promptPack: promptPackPreference,
    promptPackMode: promptPackModePreference,
    skillInstall: skillInstallEnabled,
    shellEnv: shellEnvEnabled,
    binDir: resolvedBin,
    installType: 'npm',
    npmDir,
    npmPackage: resolvedNpmPackage,
    npmVersion: resolvedNpmVersion,
  };
  writeJson(path.join(variantDir, 'variant.json'), meta);

  return { meta, wrapperPath, tweakResult, notes: notes.length > 0 ? notes : undefined };
};

export const updateVariant = (rootDir: string, name: string, opts: UpdateVariantOptions = {}): UpdateVariantResult => {
  const report = (step: string) => opts.onProgress?.(step);

  const resolvedRoot = expandTilde(rootDir || DEFAULT_ROOT) ?? rootDir;
  const variantDir = path.join(resolvedRoot, name);
  const meta = loadVariantMeta(variantDir);
  if (!meta) throw new Error(`Variant not found: ${name}`);

  const resolvedNpmPackage = normalizeNpmPackage(opts.npmPackage ?? meta.npmPackage);
  const resolvedNpmVersion = normalizeNpmVersion();
  const commandStdio = opts.tweakccStdio || 'inherit';
  const promptPackPreference =
    opts.promptPack ?? meta.promptPack ?? shouldEnablePromptPack(meta.provider);
  const promptPackModePreference =
    opts.promptPackMode ?? meta.promptPackMode ?? defaultPromptPackMode(meta.provider);
  const promptPackEnabled = !opts.noTweak && promptPackPreference;
  const skillInstallEnabled = opts.skillInstall ?? meta.skillInstall ?? shouldInstallSkills(meta.provider);
  const shellEnvEnabled = opts.shellEnv ?? meta.shellEnv ?? shouldEnableShellEnv(meta.provider);
  const skillUpdateEnabled = Boolean(opts.skillUpdate);
  let brandKey = meta.brand ?? null;

  report(`Installing ${resolvedNpmPackage}@${resolvedNpmVersion}...`);
  const npmDir = meta.npmDir || path.join(variantDir, 'npm');
  ensureDir(npmDir);
  const install = installNpmClaude({
    npmDir,
    npmPackage: resolvedNpmPackage,
    npmVersion: resolvedNpmVersion,
    stdio: commandStdio,
  });
  meta.binaryPath = install.cliPath;
  meta.installType = 'npm';
  meta.npmDir = npmDir;
  meta.npmPackage = resolvedNpmPackage;
  meta.npmVersion = resolvedNpmVersion;
  meta.claudeOrig = `npm:${resolvedNpmPackage}@${resolvedNpmVersion}`;

  const notes: string[] = [];
  if (opts.modelOverrides && Object.keys(opts.modelOverrides).length > 0) {
    const envOverridesUpdated = ensureSettingsEnvOverrides(meta.configDir, {
      ...(opts.modelOverrides.sonnet ? { ANTHROPIC_DEFAULT_SONNET_MODEL: opts.modelOverrides.sonnet } : {}),
      ...(opts.modelOverrides.opus ? { ANTHROPIC_DEFAULT_OPUS_MODEL: opts.modelOverrides.opus } : {}),
      ...(opts.modelOverrides.haiku ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: opts.modelOverrides.haiku } : {}),
      ...(opts.modelOverrides.smallFast ? { ANTHROPIC_SMALL_FAST_MODEL: opts.modelOverrides.smallFast } : {}),
      ...(opts.modelOverrides.defaultModel ? { ANTHROPIC_MODEL: opts.modelOverrides.defaultModel } : {}),
      ...(opts.modelOverrides.subagentModel ? { CLAUDE_CODE_SUBAGENT_MODEL: opts.modelOverrides.subagentModel } : {}),
    });
    if (envOverridesUpdated) {
      notes.push('Updated model mapping in settings.json.');
    }
  }
  let tweakResult: UpdateVariantResult['tweakResult'] = null;
  if (!opts.noTweak) {
    report('Running tweakcc patches...');
    ensureDir(meta.tweakDir);
    if (opts.brand !== undefined) {
      brandKey = resolveBrandKey(meta.provider, opts.brand);
      meta.brand = brandKey ?? undefined;
    }
    ensureTweakccConfig(meta.tweakDir, brandKey);
    tweakResult = runTweakcc(meta.tweakDir, meta.binaryPath, commandStdio);
    if (tweakResult.status !== 0) {
      const output = `${tweakResult.stderr ?? ''}\n${tweakResult.stdout ?? ''}`.trim();
      throw new Error(formatTweakccFailure(output));
    }

    if (promptPackEnabled) {
      report(`Applying prompt pack (${promptPackModePreference})...`);
      const packResult = applyPromptPack(meta.tweakDir, meta.provider, promptPackModePreference);
      if (packResult.changed) {
        notes.push(`Prompt pack applied (${packResult.mode}, ${packResult.updated.join(', ')})`);
        report('Re-applying tweakcc...');
        const reapply = runTweakcc(meta.tweakDir, meta.binaryPath, commandStdio);
        tweakResult = reapply;
        if (reapply.status !== 0) {
          const output = `${reapply.stderr ?? ''}\n${reapply.stdout ?? ''}`.trim();
          throw new Error(formatTweakccFailure(output));
        }
      }
    }
  }

  report('Writing CLI wrapper...');
  const resolvedBin = opts.binDir ? expandTilde(opts.binDir) ?? opts.binDir : meta.binDir;
  if (resolvedBin) {
    ensureDir(resolvedBin);
    const wrapperPath = path.join(resolvedBin, name);
    writeWrapper(wrapperPath, meta.configDir, meta.binaryPath, 'node');
    meta.binDir = resolvedBin;
  }

  report('Updating configuration...');
  ensureApiKeyApproval(meta.configDir);
  if (meta.provider === 'minimax') {
    report('Configuring MiniMax MCP server...');
    ensureMinimaxMcpServer(meta.configDir);
  }
  if (meta.provider === 'zai') {
    const denied = ensureZaiMcpDeny(meta.configDir);
    if (denied) {
      notes.push('Blocked Z.ai-injected MCP tools in settings.json.');
    }
  }
  const brandThemeId = !opts.noTweak && brandKey ? getBrandThemeId(brandKey) : null;
  const onboarding = ensureOnboardingState(meta.configDir, {
    themeId: brandThemeId ?? 'dark',
    forceTheme: Boolean(brandThemeId),
  });
  const envDefaultsUpdated = ensureSettingsEnvDefaults(meta.configDir, {
    TWEAKCC_CONFIG_DIR: meta.tweakDir,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: '1',
  });
  if (envDefaultsUpdated) {
    notes.push('Disabled Claude Code auto-updater (DISABLE_AUTOUPDATER=1).');
  }
  if (onboarding.themeChanged) {
    notes.push(`Default theme set to ${brandThemeId ?? 'dark'}.`);
  }
  if (onboarding.onboardingChanged) {
    notes.push('Onboarding marked complete.');
  }

  if (shellEnvEnabled && meta.provider === 'zai') {
    report('Configuring shell environment...');
    const shellResult = ensureZaiShellEnv({ configDir: meta.configDir });
    if (shellResult.status === 'updated') {
      const suffix = shellResult.message ? ` (${shellResult.message})` : '';
      notes.push(`Z_AI_API_KEY written to ${shellResult.path}${suffix}`);
    } else if (shellResult.status === 'failed') {
      notes.push(`Z_AI_API_KEY not written: ${shellResult.message || 'unknown error'}`);
    } else if (shellResult.message) {
      notes.push(`Z_AI_API_KEY: ${shellResult.message}`);
    }
  } else if (meta.provider === 'zai' && opts.shellEnv === false) {
    notes.push('Z_AI_API_KEY not written to shell profile. Set it manually in your shell rc file.');
  }

  if (skillInstallEnabled) {
    report('Installing dev-browser skill...');
    const skillResult = ensureDevBrowserSkill({
      install: true,
      update: skillUpdateEnabled,
      targetDir: path.join(meta.configDir, 'skills'),
    });
    if (skillResult.status === 'failed') {
      notes.push(`dev-browser skill install failed: ${skillResult.message || 'unknown error'}`);
    } else if (skillResult.status !== 'skipped') {
      notes.push(`dev-browser skill ${skillResult.status}`);
    }
  }

  report('Finalizing variant...');
  meta.updatedAt = new Date().toISOString();
  meta.promptPack = promptPackPreference;
  meta.promptPackMode = promptPackModePreference;
  meta.skillInstall = skillInstallEnabled;
  meta.shellEnv = shellEnvEnabled;
  writeJson(path.join(variantDir, 'variant.json'), meta);

  return { meta, tweakResult, notes: notes.length > 0 ? notes : undefined };
};

export const removeVariant = (rootDir: string, name: string) => {
  const resolvedRoot = expandTilde(rootDir || DEFAULT_ROOT) ?? rootDir;
  const variantDir = path.join(resolvedRoot, name);
  if (!fs.existsSync(variantDir)) throw new Error(`Variant not found: ${name}`);
  fs.rmSync(variantDir, { recursive: true, force: true });
};

export const doctor = (rootDir: string, binDir: string): DoctorReportItem[] => {
  const resolvedRoot = expandTilde(rootDir || DEFAULT_ROOT) ?? rootDir;
  const resolvedBin = expandTilde(binDir || DEFAULT_BIN_DIR) ?? binDir;
  const variants = listVariantsImpl(resolvedRoot);
  return variants.map(({ name, meta }) => {
    const wrapperPath = path.join(resolvedBin, name);
    const ok = Boolean(meta && fs.existsSync(meta.binaryPath) && fs.existsSync(wrapperPath));
    return {
      name,
      ok,
      binaryPath: meta?.binaryPath,
      wrapperPath,
    };
  });
};

export const listVariants = (rootDir: string): VariantEntry[] => listVariantsImpl(rootDir);

export const tweakVariant = (rootDir: string, name: string): void => {
  const resolvedRoot = expandTilde(rootDir || DEFAULT_ROOT) ?? rootDir;
  const variantDir = path.join(resolvedRoot, name);
  const meta = loadVariantMeta(variantDir);
  if (!meta) throw new Error(`Variant not found: ${name}`);
  ensureDir(meta.tweakDir);
  const brandKey = meta.brand ?? null;
  ensureTweakccConfig(meta.tweakDir, brandKey);
  const result = launchTweakccUi(meta.tweakDir, meta.binaryPath);
  if (result.status && result.status !== 0) {
    const output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim();
    throw new Error(formatTweakccFailure(output));
  }
};
