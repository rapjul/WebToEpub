# WebToEpub Agent Guide

This file provides practical instructions for coding agents working in this repository.

## Project Summary

WebToEpub is a browser extension (Firefox + Chrome) that converts supported web pages (primarily web novels) into EPUB files.

- Main extension source: `plugin/`
- Site parsers and core logic: `plugin/js/`
- Styling: `plugin/css/`
- Unit tests (QUnit): `unitTest/`
- Build/lint packaging scripts: `eslint/`

## Key Principles

1. Keep changes minimal and targeted.
2. Preserve existing behavior unless the task explicitly requests change.
3. Prefer fixing root causes over adding one-off workarounds.
4. Follow existing naming and file patterns in `plugin/js/` and `unitTest/`.

## Environment & Setup

Install dependencies:

```bash
npm install
```

`postinstall` copies required runtime libraries into `plugin/`:

- `@zip.js/zip.js` -> `plugin/`
- `dompurify` -> `plugin/`

## Validation Commands

Use these commands before finalizing changes:

- Lint packed extension bundle:

  ```bash
  npm run lint
  ```

- Build packed extension files:

  ```bash
  npm run build
  ```

- Run unit tests (opens browser test page):

  ```bash
  npm test
  ```

  Note: contributors have reported unit tests are often easier to run in Firefox.

## Where to Make Common Changes

### Add or update site parsing

- Add/update parser implementation in `plugin/js/`.
- Register parser in parser selection/factory logic.
- Add/adjust matching unit tests in `unitTest/`.
- Reuse fixtures from `testdata/` where possible.

### UI/options changes

- Popup/options markup: `plugin/popup.html`
- UI controllers and behavior: `plugin/js/*UI*.js` and related modules
- Preferences persistence: `plugin/js/UserPreferences.js` (and tests)

### Packaging/lint tooling

- Scripts under `eslint/` are part of build and lint workflows.
- Avoid changing packaging behavior unless needed by task.

## Change Safety Checklist

Before handing off a change:

1. Run relevant targeted unit tests for affected module(s).
2. Run `npm run lint` if JS files or build scripts changed.
3. Verify no unrelated files were modified.
4. If behavior changed, ensure it is user-controllable and defaults are safe.

## Contribution Conventions

From existing project guidance:

- Keep extension behavior stable; avoid surprise behavior changes.
- Ensure existing unit tests still pass.
- Keep ESLint warnings/errors resolved.
- Primary integration branch is `ExperimentalTabMode`.

## Notes for Agents

- Do not add new dependencies unless required by the task.
- Do not refactor large unrelated areas during focused fixes.
- If adding a new feature, include/adjust tests in `unitTest/`.
- If user-visible behavior changes, update documentation (`readme.md` or relevant docs) when appropriate.
