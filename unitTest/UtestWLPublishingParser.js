"use strict";

module("WLPublishingParser");

function loadStoriesOnlineSampleDoc() {
    return new DOMParser().parseFromString(
        "<html><head><title>Legacy - Science Fiction Story</title></head>" +
        "<body><article><h1>Legacy</h1><h2>Preview</h2><h2>by Uruks</h2></article></body></html>",
        "text/html"
    );
}

QUnit.test("extractAuthor-usesByline", function (assert) {
    let parser = new WLPublishingParser();
    assert.equal(parser.extractAuthor(loadStoriesOnlineSampleDoc()), "Uruks");
});

QUnit.test("getEpubMetaInfo-usesBylineAuthor", function (assert) {
    let parser = new WLPublishingParser();
    let metaInfo = parser.getEpubMetaInfo(loadStoriesOnlineSampleDoc());
    assert.equal(metaInfo.title, "Legacy");
    assert.equal(metaInfo.author, "Uruks");
});

QUnit.test("parserFactory-usesWLPublishingParser", function (assert) {
    let parser = parserFactory.fetch("https://storiesonline.net/s/29426/legacy-the-ministry-of-fire");
    assert.ok(parser instanceof WLPublishingParser);
});
