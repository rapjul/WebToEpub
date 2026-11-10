
"use strict";

module("UtestRoyalRoadParser");

QUnit.test("removeOlderChapterNavJunk", function (assert) {
    let dom = TestUtils.makeDomWithBody(
        "<h1 id=\"e1\">&lt;--&gt;</h1>" +
        "<div id=\"d1\"><p id=\"p1\">1</p><p id=\"p2\">2</p><p id=\"p2\">&lt;--&gt;</p></div>" +
        "<h2 id=\"e2\">&lt;--&gt;</h2>"
    );
    assert.equal(dom.body.textContent, "<-->12<--><-->");
    RoyalRoadParser.removeOlderChapterNavJunk(dom.body);
    assert.equal(dom.querySelector("h1").textContent, "");
    assert.equal(dom.querySelector("div").textContent, "12");
    assert.equal(dom.body.textContent, "12");
});

QUnit.test("fictionUrl normalizes chapter URLs to fiction index URL", function (assert) {
    let chapterUrl = "https://www.royalroad.com/fiction/159064/the-black-cat-hero-and-the-minister-of-sloth-a/chapter/3191775/episode-2-the-night-that-shattered?foo=bar#top";
    let expectedFictionUrl = "https://www.royalroad.com/fiction/159064/the-black-cat-hero-and-the-minister-of-sloth-a";
    assert.equal(RoyalRoadParser.fictionUrl(chapterUrl), expectedFictionUrl);
    assert.equal(RoyalRoadParser.fictionUrl(expectedFictionUrl), expectedFictionUrl);
});

QUnit.test("isCustomError and setCustomErrorResponse detect bot challenge for string and responseXML payloads", function (assert) {
    let parser = new RoyalRoadParser();
    let botHtml = "<html><head><title>Making sure you're not a bot!</title></head><body>Challenge</body></html>";
    let normalHtml = "<html><head><title>Chapter 1</title></head><body><div class=\"chapter-inner\"><p>Hello</p></div></body></html>";
    let botDoc = new DOMParser().parseFromString(botHtml, "text/html");
    let normalDoc = new DOMParser().parseFromString(normalHtml, "text/html");

    assert.equal(parser.isCustomError(botHtml), true, "detects bot challenge from HTML string");
    assert.equal(parser.isCustomError({responseXML: botDoc}), true, "detects bot challenge from FetchResponseHandler object");
    assert.equal(parser.isCustomError(normalHtml), false, "does not flag normal HTML string");
    assert.equal(parser.isCustomError({responseXML: normalDoc}), false, "does not flag normal FetchResponseHandler object");

    let chapterUrl = "https://www.royalroad.com/fiction/159064/the-black-cat-hero-and-the-minister-of-sloth-a/chapter/3191775/episode-2-the-night-that-shattered";
    let wrapOptions = {retryCount: 0};
    let customErr = parser.setCustomErrorResponse(chapterUrl, wrapOptions, {
        responseXML: botDoc,
        response: {url: chapterUrl}
    });
    assert.equal(customErr.url, chapterUrl);
    assert.equal(customErr.response.status, 403);
    assert.equal(customErr.response.url, chapterUrl);
});

QUnit.test("removeOrphanEpubImageArtifacts strips EPUB relative image artifacts and empty links", function (assert) {
    let dom = TestUtils.makeDomWithBody(
        "<div>" +
            "<p>Paragraph with clear image: <img id=\"img1\" src=\"../Images/0002_clear.png\"></p>" +
            "<p>Paragraph with blob rofl: <img id=\"img2\" src=\"Images/0005_blob_rofl.png\"></p>" +
            "<p id=\"pWrap\"><a id=\"a1\" href=\"../Images/0006_blob_popcorn_2.png\"><img id=\"img3\" src=\"../Images/0006_blob_popcorn_2.png\"></a></p>" +
            "<p><img id=\"img4\" src=\"https://www.royalroad.com/fiction/115417/returning-transcendent-opens-an-idol-agency/chapter/Images/0001_MiniHappy_TradeOffer.png\"></p>" +
            "<p><img id=\"legit1\" src=\"https://www.royalroadcdn.com/public/covers/115417.jpg\"></p>" +
            "<p><img id=\"legit2\" src=\"https://i.imgur.com/example.png\"></p>" +
            "<p><a id=\"legitLink\" href=\"https://www.royalroadcdn.com/file.png\"><img id=\"legit3\" src=\"https://www.royalroadcdn.com/file.png\"></a></p>" +
        "</div>"
    );

    let parser = new RoyalRoadParser();
    parser.removeOrphanEpubImageArtifacts(dom.body);

    assert.equal(dom.getElementById("img1"), null, "img1 with ../Images/ was removed");
    assert.equal(dom.getElementById("img2"), null, "img2 with Images/ was removed");
    assert.equal(dom.getElementById("img3"), null, "img3 in anchor was removed");
    assert.equal(dom.getElementById("a1"), null, "empty wrapping anchor a1 was removed");
    assert.equal(dom.getElementById("img4"), null, "img4 with /chapter/Images/ was removed");

    assert.notEqual(dom.getElementById("legit1"), null, "legitimate Royal Road CDN image preserved");
    assert.notEqual(dom.getElementById("legit2"), null, "legitimate external image preserved");
    assert.notEqual(dom.getElementById("legit3"), null, "legitimate linked CDN image preserved");
    assert.notEqual(dom.getElementById("legitLink"), null, "legitimate anchor preserved");
});

QUnit.test("getRateLimit enforces minimumThrottle even when overrideMinimumDelay is enabled", function (assert) {
    let parser = new RoyalRoadParser();
    parser.userPreferences = {
        overrideMinimumDelay: { value: true },
        manualDelayPerChapter: { value: "500" }
    };

    assert.equal(parser.minimumThrottle, 2000, "minimum throttle is 2000 ms");
    assert.equal(parser.getRateLimit(), 2000, "enforces 2000 ms floor despite overrideMinimumDelay=true and manualDelay=500");

    parser.userPreferences.manualDelayPerChapter.value = "3500";
    assert.equal(parser.getRateLimit(), 3500, "allows higher manual delay when user selects a slower rate");

    parser.userPreferences.overrideMinimumDelay.value = false;
    parser.userPreferences.manualDelayPerChapter.value = "500";
    assert.equal(parser.getRateLimit(), 2000, "defaults to 2000 ms when override is false");
});

QUnit.test("fetchChapter updates previousChapterUrl for Referer chaining", async function (assert) {
    let parser = new RoyalRoadParser();
    let recordedRules = null;
    let prevSetRules = HttpClient.setDeclarativeNetRequestRules;
    let prevWrapFetch = HttpClient.wrapFetch;

    HttpClient.setDeclarativeNetRequestRules = async (rules) => {
        recordedRules = rules;
    };
    HttpClient.wrapFetch = async (url) => ({
        responseXML: new DOMParser().parseFromString("<html><head><title>Chapter</title></head></html>", "text/html")
    });

    let ch1 = "https://www.royalroad.com/fiction/159064/slug/chapter/1/ch1";
    let ch2 = "https://www.royalroad.com/fiction/159064/slug/chapter/2/ch2";

    parser.tocUrl = "https://www.royalroad.com/fiction/159064/slug";
    await parser.fetchChapter(ch1);
    assert.equal(parser.previousChapterUrl, ch1, "recorded ch1 as previous chapter");
    let ch1Referer = recordedRules?.[0]?.action?.requestHeaders?.find(h => h.header === "referer")?.value;
    assert.equal(ch1Referer, parser.tocUrl, "ch1 used TOC as referer");

    await parser.fetchChapter(ch2);
    assert.equal(parser.previousChapterUrl, ch2, "recorded ch2 as previous chapter");
    let ch2Referer = recordedRules?.[0]?.action?.requestHeaders?.find(h => h.header === "referer")?.value;
    assert.equal(ch2Referer, ch1, "ch2 chained ch1 as referer");

    HttpClient.setDeclarativeNetRequestRules = prevSetRules;
    HttpClient.wrapFetch = prevWrapFetch;
});

QUnit.test("makeFetchRules sets referer and removes origin without spoofing sec-fetch headers", function (assert) {
    let rules = RoyalRoadParser.makeFetchRules("https://www.royalroad.com/fiction/159064/slug");
    assert.equal(rules.length, 1, "generates one rule");
    let actionHeaders = rules[0].action.requestHeaders;
    let headersMap = new Map(actionHeaders.map(h => [h.header.toLowerCase(), h]));

    assert.equal(headersMap.get("origin")?.operation, "remove", "origin header removed");
    assert.equal(headersMap.get("referer")?.operation, "set", "referer header set");
    assert.equal(headersMap.get("referer")?.value, "https://www.royalroad.com/fiction/159064/slug", "referer value matches");
    assert.notOk(headersMap.has("sec-fetch-dest"), "does not spoof sec-fetch-dest");
    assert.notOk(headersMap.has("sec-fetch-mode"), "does not spoof sec-fetch-mode");
    assert.notOk(headersMap.has("sec-fetch-site"), "does not spoof sec-fetch-site");
});

QUnit.test("fetchChapter skips declarative header rules on Firefox", async function (assert) {
    let parser = new RoyalRoadParser();
    let rulesCalled = false;
    let prevSetRules = HttpClient.setDeclarativeNetRequestRules;
    let prevWrapFetch = HttpClient.wrapFetch;
    let prevIsFirefox = util.isFirefox;

    util.isFirefox = () => true;
    HttpClient.setDeclarativeNetRequestRules = async () => {
        rulesCalled = true;
    };
    HttpClient.wrapFetch = async () => ({
        responseXML: new DOMParser().parseFromString("<html><head><title>Chapter</title></head></html>", "text/html")
    });

    let ch1 = "https://www.royalroad.com/fiction/159064/slug/chapter/1/ch1";
    await parser.fetchChapter(ch1);
    assert.equal(rulesCalled, false, "did not set declarative rules on Firefox");
    assert.equal(parser.previousChapterUrl, ch1, "still updated previousChapterUrl");

    util.isFirefox = prevIsFirefox;
    HttpClient.setDeclarativeNetRequestRules = prevSetRules;
    HttpClient.wrapFetch = prevWrapFetch;
});

QUnit.test("getChapterUrls does not set declarative header rules for table of contents fetch", async function (assert) {
    let parser = new RoyalRoadParser();
    let rulesCalled = false;
    let prevSetRules = HttpClient.setDeclarativeNetRequestRules;
    let prevFetchText = HttpClient.fetchText;

    HttpClient.setDeclarativeNetRequestRules = async () => {
        rulesCalled = true;
    };
    HttpClient.fetchText = async () => (
        '<html><head><script>window.chapters = [{"id":1,"title":"Ch 1","url":"/chapter/1"}];</script></head><body></body></html>'
    );

    let dom = new DOMParser().parseFromString("<html><head><base href=\"https://www.royalroad.com/fiction/159064/slug\"></head><body></body></html>", "text/html");
    let chapters = await parser.getChapterUrls(dom);

    assert.equal(rulesCalled, false, "TOC fetch does not call setDeclarativeNetRequestRules");
    assert.equal(chapters.length, 1, "parsed chapters from TOC");

    HttpClient.setDeclarativeNetRequestRules = prevSetRules;
    HttpClient.fetchText = prevFetchText;
});

QUnit.test("getChapterUrls extracts directly from active tab DOM without network fetch", async function (assert) {
    let parser = new RoyalRoadParser();
    let fetchCalled = false;
    let prevFetchText = HttpClient.fetchText;

    HttpClient.fetchText = async () => {
        fetchCalled = true;
        throw new Error("Should not make network fetch when active tab DOM already has chapters");
    };

    let dom = new DOMParser().parseFromString(
        '<html><head><base href="https://www.royalroad.com/fiction/182375/the-dao-of-the-goat"><script>window.chapters = [{"id":101,"title":"Episode 1: The Beginning","url":"/chapter/101"}];</script></head><body></body></html>',
        "text/html"
    );
    let chapters = await parser.getChapterUrls(dom);

    assert.equal(fetchCalled, false, "did not perform network fetch");
    assert.equal(chapters.length, 1, "extracted chapter directly from active tab DOM");
    assert.equal(chapters[0].title, "Episode 1: The Beginning");
    assert.equal(chapters[0].sourceUrl, "https://www.royalroad.com/chapter/101");

    HttpClient.fetchText = prevFetchText;
});
