# Design: Replace Yarn with Deno as Package Manager

**Date:** 2026-07-22
**Branch:** feat/deno-desktop-experiment
**Related:** Issue #10, PR #11

## Goal

Replace Yarn 1 as the package manager and script runner with Deno, as the first concrete step of the Deno Desktop experiment. App source files remain untouched.

## Approach

Deno workspaces + `npm:` specifiers (Approach A). A root `deno.json` declares the workspace and all tasks. Each sub-package gets its own `deno.json`. The `app/deno.json` carries an import map covering all 58 app dependencies as `npm:` specifiers — bare imports in `app/src/` continue to resolve unchanged.

## Scope

**In scope:**
- Replace `yarn install` with `deno install`
- Replace all `yarn run <script>` commands with `deno task <name>`
- Migrate all 58 `app/package.json` dependencies to `app/deno.json` import map
- Replace `yarn.lock` with `deno.lock`
- Remove vendored Yarn binary (`vendor/yarn-1.21.1.js`)
- Simplify `script/post-install.ts` (remove Yarn invocation)

**Deferred:**
- Native addon FFI migration (`desktop-trampoline`, `desktop-notifications`, `windows-argv-parser`) — node-gyp shelled out from `deno task rebuild-native`
- `deno lint` migration — ESLint kept entirely, wrapped in `deno task lint`
- Webpack replacement — still invoked via deno tasks, not replaced

## File Changes

### Added
| File | Purpose |
|---|---|
| `deno.json` | Workspace root: declares members, all task definitions |
| `deno.lock` | Integrity lockfile (replaces `yarn.lock`, auto-generated) |
| `app/deno.json` | Import map: all 58 deps as `npm:` specifiers |
| `vendor/*/deno.json` | Per-vendor-package task config (build, tsc) |

### Removed
| File | Reason |
|---|---|
| `yarn.lock` | Replaced by `deno.lock` |
| `vendor/yarn-1.21.1.js` | Vendored Yarn binary no longer needed |

### Modified
| File | Change |
|---|---|
| `package.json` | Scripts section removed; file kept as minimal shell for ESLint plugin deps |
| `app/package.json` | Deps section moved to `app/deno.json`; file kept as stub for Electron build tools that require it |
| `script/post-install.ts` | Remove `findYarnVersion()` and Yarn invocation; `deno install` handles resolution |

### Untouched
- `app/src/**` — zero import changes; bare specifiers resolve via import map
- `script/*.ts` (other scripts) — run via `deno run` instead of `ts-node`, no edits needed
- `eslint-rules/`, `.eslintrc.yml` — ESLint kept as-is

## Task Mapping

| Old (`yarn`) | New (`deno task`) | Notes |
|---|---|---|
| `yarn install` | `deno install` | Writes `deno.lock` |
| `yarn start` | `deno task start` | `deno run` replaces `ts-node` |
| `yarn build:dev` | `deno task build:dev` | Shells to webpack |
| `yarn build:prod` | `deno task build:prod` | Shells to webpack |
| `yarn test` | `deno task test` | Shells to existing test runner |
| `yarn lint` | `deno task lint` | Shells to ESLint (unchanged) |
| `yarn rebuild-native` | `deno task rebuild-native` | Shells to `node-gyp rebuild` per vendor |
| `yarn compile:script` | retired | Deno runs `.ts` natively |

## Risk & Rollback

**Primary risk:** CJS-only npm packages that Deno's `npm:` compatibility layer handles differently than Node. These surface at `deno install` time with a clear error — not silently at runtime.

**Rollback:** `git checkout yarn.lock package.json app/package.json`. Nothing in `app/src/` changes, so there is no app code to unwind.

## Out of Scope

- Deno FFI for native addons (separate experiment step)
- Replacing Electron with Deno Desktop UI layer (later step)
- Replacing Webpack with Deno-native bundler (later step)
- `deno lint` custom plugin migration (blocked on upstream Deno feature)
- `windows-argv-parser` pure-TS replacement (deferred; dead code on macOS)
