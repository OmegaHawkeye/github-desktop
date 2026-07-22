# Deno Desktop Experiment

Tracking document for the feasibility study of converting GitHub Desktop to run on [Deno](https://deno.com/).

Closes #10

## Goal

Determine whether the GitHub Desktop codebase can be migrated from its current Node.js + Electron stack to a Deno-based runtime and desktop framework — using [Deno Desktop](https://deno.com/).

## Current Stack

| Layer | Current |
|---|---|
| Runtime | Node.js v24 |
| UI shell | Electron |
| Package manager | Yarn 1 |
| Bundler | Webpack 5 |
| Native addons | node-gyp (C++) |
| TypeScript | tsc via ts-node |

## Proposed Stack

| Layer | Deno equivalent |
|---|---|
| Runtime | Deno |
| UI shell | Deno Desktop |
| Package manager | Deno workspaces + import maps |
| Bundler | `deno bundle` / esbuild via Deno |
| Native addons | Deno FFI |
| TypeScript | First-class (no separate tsc step) |

## Audit Checklist

### Native Addons

- [ ] `desktop-trampoline` — C++ SSH/credential trampoline. Candidate for Deno FFI replacement.
- [ ] `desktop-notifications` — OS notification bridge. Candidate for Deno FFI or Deno Desktop API.
- [ ] `windows-argv-parser` — Windows argv parsing. Could be pure Deno/TS on that platform.
- [ ] `registry-js` — Windows registry access. Candidate for Deno FFI.
- [ ] `dugite` — Git binary wrapper. Could use `Deno.Command` directly.

### Build System

- [ ] Replace `webpack.development.ts` / `webpack.production.ts` with `esbuild` via Deno or Deno's native bundler.
- [ ] Replace `ts-node` script runner with `deno run`.
- [ ] Replace Yarn workspaces with Deno workspaces (`deno.json` at root).

### UI / Electron APIs

- [ ] Audit usage of `electron` APIs (`ipcMain`, `ipcRenderer`, `BrowserWindow`, `dialog`, `shell`, `app`) and map to Deno Desktop equivalents.
- [ ] Audit `contextBridge` / `preload` scripts for the Deno Desktop IPC model.

### Dependencies

- [ ] Audit all npm packages for Deno/JSR equivalents or ESM-compatible alternatives.
- [ ] Identify packages with no Deno alternative (blockers).

## Next Steps

1. Complete the audit checklist above.
2. Prototype a minimal Deno entry point that can import and run a stripped-down version of the app model layer.
3. Assess Deno Desktop feasibility for the Electron UI surface.
4. Report findings and decide whether to proceed with a full migration.
