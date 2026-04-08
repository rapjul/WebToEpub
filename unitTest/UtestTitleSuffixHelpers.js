"use strict";

module("TitleSuffixHelpers");

QUnit.test("extractChapterLabel_convertsRomanNumeralChapterLabels", function(assert) {
    assert.equal(TitleSuffixHelpers.extractChapterLabel("Chapter VII - Nightmare Fuel"), "7");
    assert.equal(TitleSuffixHelpers.extractChapterLabel("VII - Nightmare Fuel"), "7");
    assert.equal(TitleSuffixHelpers.extractChapterLabel("VII"), "7");
    assert.equal(TitleSuffixHelpers.extractChapterLabel("Episode IV"), "4");
    assert.equal(TitleSuffixHelpers.extractChapterLabel("Nightmare Fuel"), null);
});