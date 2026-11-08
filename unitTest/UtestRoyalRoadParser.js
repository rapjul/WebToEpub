
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

QUnit.test("makeHiddenElementsVisible", function (assert) {
    let dom = TestUtils.makeDomWithBody(
        "<div style=\"display: none;\">Spoiler</div>"
    );
    let div = dom.querySelector("div");
    new RoyalRoadParser().makeHiddenElementsVisible(dom.body);
    assert.equal(div.outerHTML, "<div>Spoiler</div>");
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
