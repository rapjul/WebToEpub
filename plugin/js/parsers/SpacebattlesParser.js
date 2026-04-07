/*
 * Parser for Spacebattles and related forums.
 */

"use strict";

parserFactory.register("forums.spacebattles.com", () => new SpacebattlesParser());
//dead url
parserFactory.register("forums.sufficientvelocity.com", () => new SpacebattlesParser());
parserFactory.register("alternatehistory.com", () => new SpacebattlesParser());
//dead url
parserFactory.register("forum.questionablequesting.com", () => new SpacebattlesParser());
parserFactory.register("questionablequesting.com", () => new SpacebattlesParser());

class SpacebattlesParser extends Parser {
    constructor() {
        super();
        this.cache = new FetchCache();
        this.minimumThrottle = 50; // 182 at 20
        this.expectedChapterUrl = null;
    }

    async getChapterUrls(dom) {
        let chapters = [...dom.querySelectorAll("div.structItem--threadmark a")]
            .filter(this.isLinkToChapter);
        return chapters.map(a => {
            let chapter = util.hyperLinkToChapter(a);
            chapter.title = SpacebattlesParser.normalizeChapterTitle(chapter.title);
            return chapter;
        });
    }

    isLinkToChapter(link) {
        return !link.querySelector("date")
            && !(new URL(link.href).pathname.startsWith("/awards/award"));
    }

    findContent(dom) {
        return Parser.findConstrutedContent(dom);
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1.p-title-value");
    }

    extractAuthor(dom) {
        let authorLabel = dom.querySelector("a.username");
        return (authorLabel === null) ? super.extractAuthor(dom) : authorLabel.textContent;
    }

    findCoverImageUrl(dom) {
        if (dom == null) {
            return null;
        }
        // Prefer explicit cover images from the header block when available.
        let header = dom.querySelector(".threadmarkListingHeader");
        if (header) {
            util.resolveLazyLoadedImages(header, "img");
            let headerImg = header.querySelector(".threadmarkListingHeader-icon img, img");
            let coverImageUrl = this.getCoverImageUrl(dom, headerImg);
            if (coverImageUrl !== null) {
                return coverImageUrl;
            }
        }

        // Fallback: first image inside the story content.
        let body = dom.querySelector("article.message-body") || dom.querySelector("div.block-body");
        if (body) {
            util.resolveLazyLoadedImages(body, "img.lazyload");
            let firstImg = body.querySelector("img");
            let coverImageUrl = this.getCoverImageUrl(dom, firstImg);
            if (coverImageUrl !== null) {
                return coverImageUrl;
            }
        }
        return null;
    }

    getCoverImageUrl(dom, imageElement) {
        let src = imageElement?.currentSrc || imageElement?.src || imageElement?.getAttribute("data-src");
        if (util.isNullOrEmpty(src)) {
            return null;
        }
        let coverImageUrl = util.resolveRelativeUrl(dom.baseURI, src);
        return SpacebattlesParser.isValidCoverImageUrl(coverImageUrl) ? coverImageUrl : null;
    }

    static isValidCoverImageUrl(url) {
        let filename = util.extractFilenameFromUrl(url).toLowerCase();
        let extension = filename.split(".").pop();
        return (extension !== "gif") && (filename !== "blue-ribbon.png");
    }

    static normalizeChapterTitle(title) {
        let normalized = Parser.normalizeWhitespace(title);
        let match = normalized.match(/^(\b(?:chapter|chap|ch|episode|ep|part)\b[\s:\-–—]{0,32})([ivxlcdm]+)\b(.*)$/i);
        if (match === null) {
            return normalized;
        }
        let numericChapter = SpacebattlesParser.parseRomanNumeral(match[2]);
        if (numericChapter === null) {
            return normalized;
        }
        return `${match[1]}${numericChapter}${match[3]}`.trim();
    }

    static parseRomanNumeral(value) {
        let roman = (value ?? "").toUpperCase();
        if (roman === "") {
            return null;
        }
        const numerals = {
            "I": 1,
            "V": 5,
            "X": 10,
            "L": 50,
            "C": 100,
            "D": 500,
            "M": 1000
        };
        let total = 0;
        let previous = 0;
        for (let i = roman.length - 1; i >= 0; i--) {
            let currentValue = numerals[roman[i]];
            if (!currentValue) {
                return null;
            }
            if (currentValue < previous) {
                total -= currentValue;
            } else {
                total += currentValue;
                previous = currentValue;
            }
        }
        return (total > 0) ? total : null;
    }

    async fetchChapter(url) {
        let article = await this.fetchArticle(url);
        if (!article && this.expectedChapterUrl && (this.expectedChapterUrl != url)) {
            article = await this.fetchArticle(this.expectedChapterUrl);
        }
        if (article == null) {
            throw new Error(`Can not find chapter ${url}`);
        }
        this.expectedChapterUrl = this.findExpectedNextChapter(article);

        let newDoc = Parser.makeEmptyDocForContent(url);
        this.addTitleToChapter(newDoc, article);
        let content = article.querySelector("article.message-body");
        util.resolveLazyLoadedImages(content, "img.lazyload");
        newDoc.content.appendChild(content);
        return newDoc.dom;
    }

    async fetchArticle(url) {
        let fetchedDom = await this.cache.fetch(url);
        let newUrl = new URL(url);
        let id = newUrl.hash.substring(1) || newUrl.href.substring(newUrl.href.lastIndexOf("/") + 1);
        let parent = fetchedDom.querySelector(`article.hasThreadmark[data-content='${id}']`);
        if (parent === null) {
            parent = fetchedDom.querySelector("#" + id)?.parentElement;
        }
        return parent;
    }

    findExpectedNextChapter(article) {
        return article.querySelector("li.threadmark-nav")
            ?.querySelector("a:nth-of-type(3)")
            ?.href;
    }

    addTitleToChapter(newDoc, parent) {
        let titleElement = parent.querySelector("span.threadmarkLabel");
        if (titleElement !== null) {
            let title = newDoc.dom.createElement("h1");
            title.textContent = titleElement.textContent.trim();
            newDoc.content.appendChild(title);
        }
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("article.threadmarkListingHeader-extraInfoChild")];
    }
}
