"use strict";

module("Double Numbering Fix");

QUnit.test("normalizeChapterTitle-stripsAggregatePrefixWhenLeadingNumberDetectedInRest", function (assert) {
  let parser = new Parser();
  // Current behavior (fails to strip)
  assert.equal(
    parser.normalizeChapterTitle("1: 1: Eyes Beneath the Blue Sky"),
    "1: Eyes Beneath the Blue Sky",
    "Should strip the redundant prefix",
  );
  assert.equal(
    parser.normalizeChapterTitle("42: 42: Collision of Fate"),
    "42: Collision of Fate",
    "Should strip the redundant prefix",
  );
});

QUnit.test("normalizeChapterTitle-standardizesSeparator", function (assert) {
  let parser = new Parser();
  assert.equal(parser.normalizeChapterTitle("1:Title"), "1: Title");
  assert.equal(parser.normalizeChapterTitle("1:  Title"), "1: Title");
  assert.equal(parser.normalizeChapterTitle("1-Title"), "1 - Title");
  assert.equal(parser.normalizeChapterTitle("1–Title"), "1 – Title");
  assert.equal(parser.normalizeChapterTitle("1—Title"), "1 — Title");
  assert.equal(parser.normalizeChapterTitle("1 - Title"), "1 - Title");

  // With 'Chapter' prefix
  assert.equal(parser.normalizeChapterTitle("Chapter 1:Title"), "Chapter 1: Title");
  assert.equal(parser.normalizeChapterTitle("Chapter 1-Title"), "Chapter 1 - Title");
  assert.equal(parser.normalizeChapterTitle("1: Chapter 1: Title"), "Chapter 1: Title");
});
