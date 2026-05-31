/**
 * TweakccStep - Runs tweakcc patches and applies prompt packs
 */

import { applyPromptPack } from '../../prompt-pack.js';
import { getTweakccResultNotes, runTweakcc, runTweakccAsync } from '../../tweakcc.js';
import { getManagedTweakccPatchIds } from '../../tweakcc-profile.js';
import { formatTweakccFailure, isRecoverableTweakccFailure } from '../../errors.js';
import type { BuildContext, BuildStep } from '../types.js';

export class TweakccStep implements BuildStep {
  name = 'Tweakcc';

  private addTweakccNotes(ctx: BuildContext): void {
    for (const note of getTweakccResultNotes(ctx.state.tweakResult)) {
      if (!ctx.state.notes.includes(note)) {
        ctx.state.notes.push(note);
      }
    }
  }

  private handleTweakccFailure(ctx: BuildContext, output: string): void {
    const message = formatTweakccFailure(output);
    if (!isRecoverableTweakccFailure(output)) {
      throw new Error(message);
    }

    ctx.prefs.promptPackEnabled = false;
    ctx.prefs.promptPackPreference = false;
    if (!ctx.state.notes.includes(message)) {
      ctx.state.notes.push(message);
    }
    const fallbackNote = 'Continuing with pristine native runtime; tweakcc theming and prompt pack were skipped.';
    if (!ctx.state.notes.includes(fallbackNote)) {
      ctx.state.notes.push(fallbackNote);
    }
  }

  execute(ctx: BuildContext): void {
    const { params, paths, prefs, state } = ctx;
    const patchIds = getManagedTweakccPatchIds(prefs.brandKey, {
      providerKey: params.providerKey,
      promptPackEnabled: prefs.promptPackEnabled,
    });

    if (params.noTweak) {
      return;
    }

    ctx.report('Running tweakcc patches...');
    state.tweakResult = runTweakcc(paths.tweakDir, state.binaryPath, prefs.commandStdio, patchIds);
    this.addTweakccNotes(ctx);

    if (state.tweakResult.status !== 0) {
      const output = `${state.tweakResult.stderr ?? ''}\n${state.tweakResult.stdout ?? ''}`.trim();
      this.handleTweakccFailure(ctx, output);
      return;
    }

    let shouldReapply = false;

    if (prefs.promptPackEnabled) {
      ctx.report('Applying prompt pack...');
      const packResult = applyPromptPack(paths.tweakDir, params.providerKey);

      if (packResult.changed) {
        state.notes.push(`Prompt pack applied (${packResult.updated.join(', ')})`);
        shouldReapply = true;
      }
    }

    if (shouldReapply) {
      ctx.report('Re-applying tweakcc...');
      const reapply = runTweakcc(paths.tweakDir, state.binaryPath, prefs.commandStdio, patchIds);
      state.tweakResult = reapply;
      this.addTweakccNotes(ctx);

      if (reapply.status !== 0) {
        const output = `${reapply.stderr ?? ''}\n${reapply.stdout ?? ''}`.trim();
        this.handleTweakccFailure(ctx, output);
        return;
      }
    }
  }

  async executeAsync(ctx: BuildContext): Promise<void> {
    const { params, paths, prefs, state } = ctx;
    const patchIds = getManagedTweakccPatchIds(prefs.brandKey, {
      providerKey: params.providerKey,
      promptPackEnabled: prefs.promptPackEnabled,
    });

    if (params.noTweak) {
      return;
    }

    await ctx.report('Running tweakcc patches...');
    state.tweakResult = await runTweakccAsync(paths.tweakDir, state.binaryPath, prefs.commandStdio, patchIds);
    this.addTweakccNotes(ctx);

    if (state.tweakResult.status !== 0) {
      const output = `${state.tweakResult.stderr ?? ''}\n${state.tweakResult.stdout ?? ''}`.trim();
      this.handleTweakccFailure(ctx, output);
      return;
    }

    let shouldReapply = false;

    if (prefs.promptPackEnabled) {
      await ctx.report('Applying prompt pack...');
      const packResult = applyPromptPack(paths.tweakDir, params.providerKey);

      if (packResult.changed) {
        state.notes.push(`Prompt pack applied (${packResult.updated.join(', ')})`);
        shouldReapply = true;
      }
    }

    if (shouldReapply) {
      await ctx.report('Re-applying tweakcc...');
      const reapply = await runTweakccAsync(paths.tweakDir, state.binaryPath, prefs.commandStdio, patchIds);
      state.tweakResult = reapply;
      this.addTweakccNotes(ctx);

      if (reapply.status !== 0) {
        const output = `${reapply.stderr ?? ''}\n${reapply.stdout ?? ''}`.trim();
        this.handleTweakccFailure(ctx, output);
        return;
      }
    }
  }
}
