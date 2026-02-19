# Summary of Changes Made

## Title and Filename Behavior

- Titles now default to the format `[[novel_title]] {To Ch [[last_chapter_number]]}` while the latest chapter number is known.
- If the final chapter number cannot be determined, the suffix switches to `[[novel_title]] {To Ch. Count of [[chapter_count]]}`.
- The new **"Append latest chapter info to title"** option (Advanced Options) controls this behavior and is enabled by default. Turning it off restores the original title handling.
- A `TitleSuffixController` keeps the displayed title and `fileNameInput` synchronized, ensuring the suffix affects only the visible title while filenames remain based on the raw novel title.
- The controller monitors chapter range changes to determine the "latest" chapter: when the last selected chapter has a numeric component in its title, that number is used; otherwise it falls back to the total selected count.
- Manual edits to the `fileNameInput` are respected—once a user changes it, the controller stops overwriting it unless the base title itself changes (or the user toggles the new checkbox).
- The preference persists via `appendLatestChapterInfo` in `UserPreferences`, so each browser profile remembers the user’s choice.
- When the preference is ON and the base title is empty, the suffix alone is shown (useful for placeholder downloads that do not expose metadata yet).

## Filename Sanitization Updates

- Filenames now preserve parentheses `()`, brackets `[]`, braces `{}`, exclamation marks `!`, and question marks `?`.
- Forward slashes `/` are converted to plus signs `+` instead of being stripped entirely, keeping filenames closer to the source title.
- The sanitizer still removes other illegal characters, and filenames are re-generated automatically unless the user manually overrides them.
- Sanitization still enforces Windows path safety: backslashes `\\`, pipes `|`, asterisks `*`, trailing dots/spaces, and reserved device names (e.g., `CON`, `PRN`) remain blocked. When the title resolves to an empty string after filtering, the logic now injects a generic `WebToEpub` filename so the download can proceed.
- Because `/` now maps to `+`, titles that signal ranges such as `Arc 5 / Part 2` keep their intent both in the visible filename and in the eventual EPUB metadata.
- The UI disables auto-regeneration of filenames once the user types in the field, but the sanitized preview still shows how prohibited characters will be handled.

## Buffer Deprecation Fix

- The ESLint packaging script replaces the deprecated `new Buffer()` usage with `Buffer.from()` to eliminate the `[DEP0005]` warning while writing bundled files.
- The change lives in `eslint/pack.js`; lint directives were added nearby to acknowledge that `Buffer` is a Node global while keeping the rest of the file ESLint-clean.
- The rest of the packaging flow (reading the source, minifying, writing `packed.js`, and generating the `.xpi`) is untouched, so existing release steps remain the same—just without the warning noise.
