
"use strict";

module("QidianParser");

QUnit.test("linkToChapter_notLocked", function (assert) {
    let dom = new DOMParser().parseFromString(QidianChatperLinkSample, "text/html");
    let link = dom.querySelector("a");
    let checkbox = dom.getElementById("removeChapterNumberCheckbox");
    document.body.appendChild(checkbox);
    let actual = QidianParser.linkToChapter(link);
    assert.equal(actual.title, "1: Young Zhao Feng");
    assert.equal(actual.isIncludeable, true);
    checkbox.remove();
});

QUnit.test("linkToChapter_Locked", function (assert) {
    let dom = new DOMParser().parseFromString(QidianChatperLinkSample, "text/html");
    let links = [...dom.querySelectorAll("a")];
    let checkbox = dom.getElementById("removeChapterNumberCheckbox");
    document.body.appendChild(checkbox);
    let actual = QidianParser.linkToChapter(links[1]);
    assert.equal(actual.title, "185: Worsen");
    assert.equal(actual.isIncludeable, false);
    checkbox.remove();
});

QUnit.test("extractTitle", function (assert) {
    let dom = new DOMParser().parseFromString(QidianChatperLinkSample, "text/html");
    let actual = new QidianParser().extractTitle(dom);
    assert.equal(actual, "King of Gods");
});

QUnit.test("constructor_readsWebnovelDownloadImagesCheckbox", function(assert) {
    let checkbox = document.createElement("input");
    checkbox.id = "webnovelDownloadImagesCheckbox";
    checkbox.type = "checkbox";
    checkbox.checked = true;
    document.body.appendChild(checkbox);

    let parser = new QidianParser();
    assert.equal(parser.downloadAndIncludeImages, true);

    checkbox.remove();
});

QUnit.test("cleanRawDom_replacesAndNormalizesHeaderFromCache", function(assert) {
    let checkbox = document.createElement("input");
    checkbox.id = "removeChapterNumberCheckbox";
    checkbox.type = "checkbox";
    checkbox.checked = true;
    document.body.appendChild(checkbox);

    let dom = new DOMParser().parseFromString(
        "<html><head><base href='https://www.webnovel.com/book/1/chapter/2'></head>" +
        "<body><div class='chapter_content'><h1>Old Title</h1><h1>Chapter 10</h1><p>Body</p></div></body></html>",
        "text/html"
    );
    let content = dom.querySelector("div.chapter_content");
    let parser = new QidianParser();
    parser.ChacheChapterTitle.set(content.baseURI, parser.normalizeChapterTitle("2: Chapter 10"));

    parser.cleanRawDom(content, true);

    assert.equal(content.querySelector("h1").textContent, "Chapter 10");
    assert.equal(content.querySelectorAll("h1").length, 1);

    checkbox.remove();
});

QUnit.test("onWebnovelDownloadImagesToggle_hidesWarningToastWhenUnchecked", function(assert) {
    window.localStorage.removeItem("webnovelParagraphImagesRateLimitWarningDismissed");

    let checkbox = document.createElement("input");
    checkbox.id = "webnovelDownloadImagesCheckbox";
    checkbox.type = "checkbox";
    checkbox.checked = true;
    document.body.appendChild(checkbox);

    let optionsRow = document.createElement("div");
    optionsRow.id = "webnovelParagraphImagesOptionsRow";
    document.body.appendChild(optionsRow);

    let parser = new QidianParser();
    parser.maybeShowWebnovelWarning();

    let toastContainer = document.getElementById("rateLimitToastContainer");
    assert.ok(toastContainer !== null && toastContainer.childElementCount > 0, "warning toast is shown");

    checkbox.checked = false;
    parser.onWebnovelDownloadImagesToggle();

    toastContainer = document.getElementById("rateLimitToastContainer");
    let warningStillVisible = [...(toastContainer?.children ?? [])]
        .some(toast => toast.textContent?.includes(UIText.Warning.warningWebnovelParagraphImagesRateLimit));
    assert.equal(warningStillVisible, false, "warning toast is removed when option is unchecked");

    optionsRow.remove();
    checkbox.remove();
    window.localStorage.removeItem("webnovelParagraphImagesRateLimitWarningDismissed");
});

QUnit.test("cleanVolumeTitle_cleansWhitespaceAndSeparators", function(assert) {
    assert.equal(QidianParser.cleanVolumeTitle(" Volume 1 :  Introduction "), "Volume 1: Introduction");
    assert.equal(QidianParser.cleanVolumeTitle("Volume 2 : Academy"), "Volume 2: Academy");
    assert.equal(QidianParser.cleanVolumeTitle("Volume 3 :  Genin Days"), "Volume 3: Genin Days");
    assert.equal(QidianParser.cleanVolumeTitle("  Volume 3:Genin Days  "), "Volume 3: Genin Days");
    assert.equal(QidianParser.cleanVolumeTitle("Volume   6 :  3rd   Shinobi   World   War"), "Volume 6: 3rd Shinobi World War");
    assert.equal(QidianParser.cleanVolumeTitle(null), null);
    assert.equal(QidianParser.cleanVolumeTitle("   "), null);
});

QUnit.test("getChapterUrls_extractsVolumeSectionsAsNewArc", async function(assert) {
    let dom = new DOMParser().parseFromString(QidianMultiVolumeCatalogSample, "text/html");
    let parser = new QidianParser();
    let chapters = await parser.getChapterUrls(dom);

    assert.equal(chapters.length, 4, "total chapters extracted");
    assert.equal(chapters[0].title, "1: The beginning");
    assert.equal(chapters[0].newArc, "Volume 1: Introduction", "first chapter in volume 1 has cleaned volume title as newArc");
    assert.equal(chapters[0].isIncludeable, true);

    assert.equal(chapters[1].title, "2: The Second Step");
    assert.equal(chapters[1].newArc, null, "subsequent chapter in volume 1 has null newArc");
    assert.equal(chapters[1].isIncludeable, true);

    assert.equal(chapters[2].title, "3: Academy Entrance");
    assert.equal(chapters[2].newArc, "Volume 2: Academy", "first chapter in volume 2 has cleaned volume title as newArc");
    assert.equal(chapters[2].isIncludeable, true);

    assert.equal(chapters[3].title, "4: Locked Practice");
    assert.equal(chapters[3].newArc, null, "subsequent chapter in volume 2 has null newArc");
    assert.equal(chapters[3].isIncludeable, false, "locked chapter is not includable");
});

QUnit.test("getChapterUrls_flatCatalogFallback", async function(assert) {
    let dom = new DOMParser().parseFromString(QidianChatperLinkSample, "text/html");
    let parser = new QidianParser();
    let chapters = await parser.getChapterUrls(dom);

    assert.equal(chapters.length, 2, "total chapters extracted from flat catalog");
    assert.equal(chapters[0].newArc, null, "flat catalog chapters have null newArc");
    assert.equal(chapters[1].newArc, null, "flat catalog chapters have null newArc");
});

let QidianChatperLinkSample =
`<!DOCTYPE html>
<html lang="en-US" class="dark-skin">
<head>
    <title>King of Gods - Eastern Fantasy - Webnovel - Your Fictional Stories Hub</title>
    <base href="https://www.webnovel.com/book/9017100806001205/King-of-Gods" />
    <meta property="og:title" content="King of Gods">
</head>
<body>
<div class="page"><h1 class="pt4 pb4 oh mb4 auto_height">King of Gods <small>KOG</small></h2><div>
<input id="removeChapterNumberCheckbox" type="checkbox">
<ol>
<li class="g_col_6" data-report-eid="E10" data-bid="King of Gods" data-report-bid="9017100806001205" data-cid="30995441462068685" data-report-cid="30995441462068685">
    <a href="//www.webnovel.com/book/9017100806001205/30995441462068685/King-of-Gods/Young-Zhao-Feng-" class="c_000 db pr clearfix pt8 pb8 pr8 pl8">
        <i class="fl fs16 lh24 c_l _num mr4 tal">1</i>
        <div class="oh">
            <strong class="db mb8 fs16 lh24 c_l ell">Young Zhao Feng </strong>
            <small class="db fs12 lh16 c_s">Aug 29,2018</small>
        </div>
    </a>
</li>
<li class="g_col_6" data-report-eid="E10" data-bid="King of Gods" data-report-bid="9017100806001205" data-cid="30995442267375141" data-report-cid="30995442267375141">
    <a href="//www.webnovel.com/book/9017100806001205/30995442267375141/King-of-Gods/Worsen-" class="c_000 db pr clearfix pt8 pb8 pr8 pl8">
        <i class="fl fs16 lh24 c_l _num mr4 tal">185</i>
        <svg class="fr _icon ml16 mt4 c_s fs16"><use xlink:href="#i-lock"></use></svg>
        <div class="oh">
            <strong class="db mb8 fs16 lh24 c_l ell">Worsen </strong>
            <small class="db fs12 lh16 c_s">Aug 29,2018</small>
        </div>
    </a>
</li>
<ol>
</body>
</html>
`

let QidianMultiVolumeCatalogSample =
`<!DOCTYPE html>
<html lang="en">
<head>
    <title>Multi Volume Story - Webnovel</title>
    <base href="https://www.webnovel.com/book/28980126008082405/catalog" />
</head>
<body>
<div class="fs16 det-con-ol oh j_catalog_list">
    <div class="volume-item">
        <h4 class="mb16 fw400 fs16 lh24 ell"> Volume 1 : Introduction </h4>
        <ol class="clearfix g_row content-list mb32">
            <li class="g_col _6">
                <a href="https://www.webnovel.com/book/28980126008082405/chapter-1" title="Chapter 1 : The beginning">
                    <i class="fl fs16 lh24 c_l _num mr4 tal">1</i>
                    <div class="oh">
                        <strong class="db mb8 fs16 lh24 c_l ell">The beginning</strong>
                    </div>
                </a>
            </li>
            <li class="g_col _6">
                <a href="https://www.webnovel.com/book/28980126008082405/chapter-2" title="Chapter 2 : The Second Step">
                    <i class="fl fs16 lh24 c_l _num mr4 tal">2</i>
                    <div class="oh">
                        <strong class="db mb8 fs16 lh24 c_l ell">The Second Step</strong>
                    </div>
                </a>
            </li>
        </ol>
    </div>
    <div class="volume-item">
        <h4 class="mb16 fw400 fs16 lh24 ell"> Volume 2 : Academy </h4>
        <ol class="clearfix g_row content-list mb32">
            <li class="g_col _6">
                <a href="https://www.webnovel.com/book/28980126008082405/chapter-3" title="Chapter 3 : Academy Entrance">
                    <i class="fl fs16 lh24 c_l _num mr4 tal">3</i>
                    <div class="oh">
                        <strong class="db mb8 fs16 lh24 c_l ell">Academy Entrance</strong>
                    </div>
                </a>
            </li>
            <li class="g_col _6">
                <a href="https://www.webnovel.com/book/28980126008082405/chapter-4" title="Chapter 4 : Locked Practice">
                    <i class="fl fs16 lh24 c_l _num mr4 tal">4</i>
                    <svg class="fr _icon ml16 mt4 c_s fs16"><use xlink:href="#i-lock"></use></svg>
                    <div class="oh">
                        <strong class="db mb8 fs16 lh24 c_l ell">Locked Practice</strong>
                    </div>
                </a>
            </li>
        </ol>
    </div>
</div>
</body>
</html>
`;
