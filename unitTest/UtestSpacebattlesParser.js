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

QUnit.test("findCoverImageUrl_skipsGifHeaderImage", function(assert) {
    let dom = new DOMParser().parseFromString(
        "<html><head><base href='https://forums.spacebattles.com/threads/story.123/'></head>" +
        "<body>" +
        "<div class='threadmarkListingHeader'><div class='threadmarkListingHeader-icon'><img src='/data/assets/reactions/plus.gif'></div></div>" +
        "<article class='message-body'><img src='/fallback.jpg'></article>" +
        "</body></html>",
        "text/html"
    );
    let actual = new SpacebattlesParser().findCoverImageUrl(dom);
    assert.equal(actual, "https://forums.spacebattles.com/fallback.jpg");
});

QUnit.test("findCoverImageUrl_returnsNullWhenOnlyGifImagesExist", function(assert) {
    let dom = new DOMParser().parseFromString(
        "<html><head><base href='https://forums.spacebattles.com/threads/story.123/'></head>" +
        "<body>" +
        "<div class='threadmarkListingHeader'><div class='threadmarkListingHeader-icon'><img src='/data/assets/reactions/applause.gif'></div></div>" +
        "<article class='message-body'><img src='/data/assets/reactions/cliffhanger.gif'></article>" +
        "</body></html>",
        "text/html"
    );
    let actual = new SpacebattlesParser().findCoverImageUrl(dom);
    assert.equal(actual, null);
});

QUnit.test("findCoverImageUrl_skipsBlueRibbonHeaderImage", function(assert) {
    let dom = new DOMParser().parseFromString(
        "<html><head><base href='https://forums.spacebattles.com/threads/story.123/'></head>" +
        "<body>" +
        "<div class='threadmarkListingHeader'><div class='threadmarkListingHeader-icon'><img src='https://forums.spacebattles.com/data/assets/reactions/blue-ribbon.png'></div></div>" +
        "<article class='message-body'><img src='/fallback.jpg'></article>" +
        "</body></html>",
        "text/html"
    );
    let actual = new SpacebattlesParser().findCoverImageUrl(dom);
    assert.equal(actual, "https://forums.spacebattles.com/fallback.jpg");
});

QUnit.test("findCoverImageUrl_returnsNullWhenOnlyBlueRibbonImageExists", function(assert) {
    let dom = new DOMParser().parseFromString(
        "<html><head><base href='https://forums.spacebattles.com/threads/story.123/'></head>" +
        "<body>" +
        "<div class='threadmarkListingHeader'><div class='threadmarkListingHeader-icon'><img src='https://forums.spacebattles.com/data/assets/reactions/blue-ribbon.png'></div></div>" +
        "<article class='message-body'><img src='https://forums.spacebattles.com/data/assets/reactions/blue-ribbon.png'></article>" +
        "</body></html>",
        "text/html"
    );
    let actual = new SpacebattlesParser().findCoverImageUrl(dom);
    assert.equal(actual, null);
});

QUnit.test("getChapterUrls_keepsRomanNumeralChapterTitlesUnchanged", function(assert) {
    let dom = new DOMParser().parseFromString(
        "<html><head><base href='https://forums.spacebattles.com/threads/story.123/'></head>" +
        "<body>" +
        "<div class='structItem--threadmark'><a href='/threads/story.123/page-7'>Chapter VII - Nightmare Fuel</a></div>" +
        "</body></html>",
        "text/html"
    );

    return new SpacebattlesParser().getChapterUrls(dom).then(function(actual) {
        assert.equal(actual.length, 1);
        assert.equal(actual[0].title, "Chapter VII - Nightmare Fuel");
        assert.equal(actual[0].sourceUrl, "https://forums.spacebattles.com/threads/story.123/page-7");
    });
});
