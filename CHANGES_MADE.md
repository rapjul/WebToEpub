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

- Filenames now preserve parentheses `()`, brackets `[]`, braces `{}`, and exclamation marks `!`.
- Question marks `?` are now **stripped** during auto-sanitization (consistent with `illegalWindowsFileNameChars`); they were previously preserved but would cause an error at pack time if left in the filename.
- Forward slashes `/` are converted to plus signs `+` instead of being stripped entirely, keeping filenames closer to the source title.
- A new Advanced Option, **"Replace illegal filename characters with Unicode lookalikes"**, lets users preserve visual readability by substituting illegal characters with full-width equivalents (for example `? → ？`, `: → ：`) before sanitization.
- Lookalike replacement is platform-aware: Windows applies the full replacement set, macOS applies colon replacement, and Linux/other platforms leave these characters unchanged (with `/` still normalized by filename sanitization).
- Auto-sanitization now preserves non-ASCII Unicode characters, allowing lookalike substitutions to survive into the final filename.
- The sanitizer still removes other illegal characters, and filenames are re-generated automatically unless the user manually overrides them.
- Sanitization still enforces Windows path safety: backslashes `\\`, pipes `|`, asterisks `*`, trailing dots/spaces, and reserved device names (e.g., `CON`, `PRN`) remain blocked. When the title resolves to an empty string after filtering, the logic now injects a generic `WebToEpub` filename so the download can proceed.
- Because `/` now maps to `+`, titles that signal ranges such as `Arc 5 / Part 2` keep their intent both in the visible filename and in the eventual EPUB metadata.
- The UI disables auto-regeneration of filenames once the user types in the field, but the sanitized preview still shows how prohibited characters will be handled.
- The popup now shows an unobtrusive amber hint row directly below the filename field whenever auto-sanitization removes characters from the title. The hint lists the exact characters that were stripped (e.g., `Removed from filename: ? *`), so the user immediately knows what changed without any intrusive error dialog.
- When lookalikes are enabled, the hint switches to replacement mode and shows explicit mappings (for example `Replaced in filename: ?→？  :→：`).

## Download/Error Handling Updates

- Custom filename validation now throws a proper UI error when illegal characters remain, instead of silently falling back to an `IllegalFileName.epub` placeholder.
- If packing fails before the download step, the popup now restores button state and reports the error without leaving the UI in a locked work-in-progress state.
- If a browser download API call returns no download ID, the code now throws an explicit error so the failure is visible and traceable.
