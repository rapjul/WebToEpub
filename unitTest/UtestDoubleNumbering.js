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

QUnit.test("normalizeChapterTitle-preservesChapterNumberWithPartSuffix", function (assert) {
  let parser = new Parser();
  assert.equal(
    parser.normalizeChapterTitle("197: The Red Wedding"),
    "197: The Red Wedding",
    "Should preserve regular chapter number",
  );
  assert.equal(
    parser.normalizeChapterTitle("198: The Red Wedding (Part II)"),
    "198: The Red Wedding (Part II)",
    "Should preserve chapter number when Part Roman numeral suffix is present",
  );
  assert.equal(
    parser.normalizeChapterTitle("199: The Red Wedding (Part III)"),
    "199: The Red Wedding (Part III)",
    "Should preserve chapter number when Part Roman numeral suffix is present",
  );
  assert.equal(
    parser.normalizeChapterTitle("210: The Trial of Littlefinger (Part 2)"),
    "210: The Trial of Littlefinger (Part 2)",
    "Should preserve chapter number when Part integer suffix is present",
  );
  assert.equal(
    parser.normalizeChapterTitle("1: Part 1: The Beginning"),
    "Part 1: The Beginning",
    "Should strip aggregate prefix when title starts with Part prefix",
  );
  assert.equal(
    parser.normalizeChapterTitle("1: Episode 5: The Journey"),
    "Episode 5: The Journey",
    "Should strip aggregate prefix when title starts with Episode prefix",
  );
});

QUnit.test("normalizeChapterTitle-handlesCommonChapterNamesAndNarrativePhrases", function (assert) {
  let parser = new Parser();
  // Narrative phrases containing common words must preserve chapter numbers
  assert.equal(
    parser.normalizeChapterTitle("186: Prelude to War"),
    "186: Prelude to War",
    "Should preserve chapter number for narrative title with 'Prelude to'",
  );
  assert.equal(
    parser.normalizeChapterTitle("10: Introduction to Magic"),
    "10: Introduction to Magic",
    "Should preserve chapter number for narrative title with 'Introduction to'",
  );
  assert.equal(
    parser.normalizeChapterTitle("5: Special Delivery"),
    "5: Special Delivery",
    "Should preserve chapter number for narrative title with 'Special'",
  );
  assert.equal(
    parser.normalizeChapterTitle("20: Extra Baggage"),
    "20: Extra Baggage",
    "Should preserve chapter number for narrative title with 'Extra'",
  );

  // Standalone structural sections and labeled subtitles should strip aggregate prefix
  assert.equal(
    parser.normalizeChapterTitle("1: Prelude"),
    "Prelude",
    "Should strip aggregate prefix for standalone 'Prelude'",
  );
  assert.equal(
    parser.normalizeChapterTitle("1: Prologue: The Beginning"),
    "Prologue: The Beginning",
    "Should strip aggregate prefix for 'Prologue: The Beginning'",
  );
  assert.equal(
    parser.normalizeChapterTitle("1: Interlude 1"),
    "Interlude 1",
    "Should strip aggregate prefix for 'Interlude 1'",
  );
  assert.equal(
    parser.normalizeChapterTitle("1: Side Story - Alice"),
    "Side Story - Alice",
    "Should strip aggregate prefix for 'Side Story - Alice'",
  );
  assert.equal(
    parser.normalizeChapterTitle("1: [Prologue]"),
    "[Prologue]",
    "Should strip aggregate prefix for '[Prologue]'",
  );
});


