
"use strict";

module("UChapterUrlsUI");

QUnit.test("chaptersToHTML", function (assert) {
    let parser = {
        chapters: [
            { isIncludeable: true,  sourceUrl: "http://a.com", title: "1" },
            { isIncludeable: false, sourceUrl: "http://b.com", title: "2" },
            { isIncludeable: true,  sourceUrl: "http://c.com", title: "3" }
        ]
    };

    let ui = new ChapterUrlsUI(parser);
    let out = ui.chaptersToHTML(parser.chapters);
    assert.equal(out, "<a href=\"http://a.com\">1</a>\r<a href=\"http://c.com\">3</a>\r");
});

QUnit.test("chaptersToHTML", function (assert) {
    let innerHtml = "<a href=\"http://a.com\">1</a>\r<a href=\"http://c.com\">3</a>\r";
    let ui = new ChapterUrlsUI(null);
    let chapters = ui.htmlToChapters(innerHtml);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].sourceUrl, "http://a.com/");
    assert.equal(chapters[1].title, "3");
});

QUnit.test("setChapterCount_updatesLabelAndNotifiesTitleSuffixController", function(assert) {
    let fixture = document.createElement("div");
    fixture.innerHTML =
        "<span id='spanChapterCount'></span>" +
        "<table id='chapterUrlsTable'>" +
        "  <tr><th>h</th></tr>" +
        "  <tr><td><input type='checkbox' checked></td><td><input type='text' value='Chapter 1'></td></tr>" +
        "  <tr><td><input type='checkbox' checked></td><td><input type='text' value='Chapter 2'></td></tr>" +
        "</table>";
    document.body.appendChild(fixture);

    let oldController = window.TitleSuffixController;
    let captured = null;
    window.TitleSuffixController = {
        onChapterSelectionChanged: function(lastTitle, count) {
            captured = {lastTitle, count};
        }
    };

    ChapterUrlsUI.setChapterCount(1, 2);

    assert.equal(document.getElementById("spanChapterCount").textContent, "2");
    assert.deepEqual(captured, {lastTitle: "Chapter 2", count: 2});

    window.TitleSuffixController = oldController;
    fixture.remove();
});

