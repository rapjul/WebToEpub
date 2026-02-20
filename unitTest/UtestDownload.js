"use strict";

module("Download");

QUnit.test("isFileNameIllegalOnWindows - valid names", function (assert) {
    assert.notOk(Download.isFileNameIllegalOnWindows("ValidName.epub"), "plain alphanumeric");
    assert.notOk(Download.isFileNameIllegalOnWindows("My Story.epub"), "name with spaces");
    assert.notOk(Download.isFileNameIllegalOnWindows("my-story_vol2.epub"), "hyphens and underscores");
    assert.notOk(Download.isFileNameIllegalOnWindows("Story (Vol. 1).epub"), "parentheses and period");
    assert.notOk(Download.isFileNameIllegalOnWindows("It's a Trap!.epub"), "apostrophe and exclamation mark");
    assert.notOk(Download.isFileNameIllegalOnWindows("Heroes & Villains.epub"), "ampersand");
    assert.notOk(Download.isFileNameIllegalOnWindows("Part 1, Part 2.epub"), "comma");
    assert.notOk(Download.isFileNameIllegalOnWindows("#1 Best Novel.epub"), "hash/number sign");
    assert.notOk(Download.isFileNameIllegalOnWindows("story+bonus.epub"), "plus sign");
    assert.notOk(Download.isFileNameIllegalOnWindows("Héros du Monde.epub"), "accented Latin characters");
    assert.notOk(Download.isFileNameIllegalOnWindows("物語.epub"), "CJK characters");
    assert.notOk(Download.isFileNameIllegalOnWindows("Привет мир.epub"), "Cyrillic characters");
    assert.notOk(Download.isFileNameIllegalOnWindows("[BL] A Love Story.epub"), "square brackets");
    assert.notOk(Download.isFileNameIllegalOnWindows("{TaggedTitle}.epub"), "curly braces");
    assert.notOk(Download.isFileNameIllegalOnWindows("100% Pure.epub"), "percent sign");
    assert.notOk(Download.isFileNameIllegalOnWindows("story@author.epub"), "at sign");
    assert.notOk(Download.isFileNameIllegalOnWindows("$tarting Over.epub"), "dollar sign");
    assert.notOk(Download.isFileNameIllegalOnWindows("story=equal.epub"), "equals sign");
    assert.notOk(Download.isFileNameIllegalOnWindows("story;note.epub"), "semicolon");
    assert.notOk(Download.isFileNameIllegalOnWindows("story`backtick.epub"), "backtick");
});

QUnit.test("isFileNameIllegalOnWindows - illegal Windows characters (one per assertion)", function (assert) {
    // Each character in illegalWindowsFileNameChars = "~/<>\\:*|\"?"
    assert.ok(Download.isFileNameIllegalOnWindows("name~name.epub"), "tilde (~)");
    assert.ok(
        Download.isFileNameIllegalOnWindows("na/me.epub"),
        "forward slash (/) — also path separator on Linux and macOS",
    );
    assert.ok(Download.isFileNameIllegalOnWindows("na<me.epub"), "less-than (<)");
    assert.ok(Download.isFileNameIllegalOnWindows("na>me.epub"), "greater-than (>)");
    assert.ok(Download.isFileNameIllegalOnWindows("na\\me.epub"), "backslash (\\) — Windows path separator");
    assert.ok(
        Download.isFileNameIllegalOnWindows("na:me.epub"),
        "colon (:) — Windows drive separator; HFS+ internal separator on macOS",
    );
    assert.ok(Download.isFileNameIllegalOnWindows("na*me.epub"), "asterisk (*) — glob wildcard on all platforms");
    assert.ok(Download.isFileNameIllegalOnWindows("na|me.epub"), "pipe (|)");
    assert.ok(Download.isFileNameIllegalOnWindows('na"me.epub'), 'double quote (")');
    assert.ok(
        Download.isFileNameIllegalOnWindows("na?me.epub"),
        "question mark (?) — glob wildcard on Windows and Linux",
    );
});

QUnit.test("isFileNameIllegalOnWindows - blank and whitespace-only names", function (assert) {
    assert.ok(Download.isFileNameIllegalOnWindows(""), "empty string");
    assert.ok(Download.isFileNameIllegalOnWindows("     "), "spaces only");
    assert.ok(Download.isFileNameIllegalOnWindows("\t"), "tab only");
    assert.ok(Download.isFileNameIllegalOnWindows("\n"), "newline only");
});

QUnit.test("isFileNameIllegalOnWindows - multiple illegal chars in one name", function (assert) {
    assert.ok(Download.isFileNameIllegalOnWindows("bad<>name.epub"), "< and > together");
    assert.ok(Download.isFileNameIllegalOnWindows("C:\\path\\file.epub"), "multiple backslashes (Windows path)");
    assert.ok(Download.isFileNameIllegalOnWindows("a|b:c*.epub"), "pipe, colon, asterisk together");
});

QUnit.test("isFileNameIllegalOnWindows - real-world novel/story title edge cases", function (assert) {
    // These are the kinds of titles that appear on fiction sites and historically caused silent failures
    assert.ok(
        Download.isFileNameIllegalOnWindows("Transmigrated Into a Cultivation World? Good Thing I Can Read Minds!.epub"),
        "question mark in isekai-style title (the original bug)",
    );
    assert.ok(Download.isFileNameIllegalOnWindows("A.I.: Artificial Intelligence.epub"), "colon in title");
    assert.ok(Download.isFileNameIllegalOnWindows("<Reincarnated as a [Slime]>.epub"), "angle brackets in title");
    assert.ok(Download.isFileNameIllegalOnWindows('He Said "I Love You".epub'), "double quotes in title");
    assert.ok(Download.isFileNameIllegalOnWindows("100% | A Split-World Story.epub"), "pipe in title");
    assert.ok(Download.isFileNameIllegalOnWindows("What Now? What Next?.epub"), "multiple question marks in title");
    assert.notOk(
        Download.isFileNameIllegalOnWindows("Transmigrated Into a Cultivation World - Good Thing I Can Read Minds!.epub"),
        "same title sanitised with hyphen instead of question mark — should be valid",
    );
});
