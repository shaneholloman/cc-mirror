export const printHelp = () => {
  console.log(`
cc-mirror

Usage:
  cc-mirror create [options]
  cc-mirror quick [options]
  cc-mirror list
  cc-mirror update [name]
  cc-mirror remove <name>
  cc-mirror doctor
  cc-mirror tweak <name>

Options (create/update):
  --name <name>            Variant name
  --provider <name>        Provider: zai | minimax | openrouter | litellm | custom
  --base-url <url>         ANTHROPIC_BASE_URL override
  --api-key <key>          Provider API key (apiKey or authToken)
  --timeout-ms <ms>        API_TIMEOUT_MS override
  --env KEY=VALUE          Additional env (repeatable)
  --model-sonnet <name>    ANTHROPIC_DEFAULT_SONNET_MODEL
  --model-opus <name>      ANTHROPIC_DEFAULT_OPUS_MODEL
  --model-haiku <name>     ANTHROPIC_DEFAULT_HAIKU_MODEL
  --model-small-fast <name> ANTHROPIC_SMALL_FAST_MODEL
  --model-default <name>   ANTHROPIC_MODEL
  --model-subagent <name>  CLAUDE_CODE_SUBAGENT_MODEL
  --brand <preset>         Brand preset: auto | none | zai | minimax | openrouter | litellm
  --quick                 Fast path: provider + API key only (npm install)
  --root <path>            Variants root (default: ~/.cc-mirror)
  --bin-dir <path>         Wrapper install dir (default: ~/.local/bin)
  --npm-package <name>     NPM package for npm installs (version pinned to 2.0.76)
  --no-tweak               Skip tweakcc patching
  --no-prompt-pack         Skip provider prompt pack (default: on for zai/minimax)
  --prompt-pack-mode <m>   Prompt pack mode: minimal | maximal (default: maximal for zai/minimax)
  --no-skill-install       Skip dev-browser skill install (default: on for zai/minimax)
  --skill-update           Force-update dev-browser skill if already present
  --shell-env              Write provider env vars into shell profile (Z.ai only)
  --no-shell-env           Skip shell profile updates
  --yes                    Non-interactive, accept defaults
  --tui                    Force TUI
  --no-tui                 Disable TUI
`);
};
