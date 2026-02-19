"use strict";

module("SpacebattlesParser");

QUnit.test("findCoverImageUrl_prefersHeaderImage", function(assert) {
    let dom = new DOMParser().parseFromString(
        "<html><head><base href='https://forums.spacebattles.com/threads/story.123/'></head>" +
        "<body>" +
        "<div class='threadmarkListingHeader'><div class='threadmarkListingHeader-icon'><img src='/cover.jpg'></div></div>" +
        "<article class='message-body'><img src='/fallback.jpg'></article>" +
        "</body></html>",
        "text/html"
    );
    let actual = new SpacebattlesParser().findCoverImageUrl(dom);
    assert.equal(actual, "https://forums.spacebattles.com/cover.jpg");
});

QUnit.test("findCoverImageUrl_fallsBackToBodyImage", function(assert) {
    let dom = new DOMParser().parseFromString(
        "<html><head><base href='https://forums.spacebattles.com/threads/story.123/'></head>" +
        "<body><article class='message-body'><img src='/fallback.jpg'></article></body></html>",
        "text/html"
    );
    let actual = new SpacebattlesParser().findCoverImageUrl(dom);
    assert.equal(actual, "https://forums.spacebattles.com/fallback.jpg");
});
