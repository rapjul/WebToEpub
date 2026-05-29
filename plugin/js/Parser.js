/*
  Base class that all parsers build from.
*/
"use strict";

/**
 * For sites that have multiple chapters per web page, this can minimize HTTP calls
 */
class FetchCache { // eslint-disable-line no-unused-vars
    /**
     * Creates an empty fetch cache.
     *
     * @returns {void}
     */
    constructor() {
        this.path = null;
        this.dom = null;
    }

    /**
     * Fetches a document and caches it by pathname so repeated calls reuse the same DOM.
     *
     * @param {string} url - The URL to fetch.
     * @returns {Promise<Document>} A cloned response XML document.
     */
    async fetch(url) {
        if (!this.inCache(url)) {
            this.dom = (await HttpClient.wrapFetch(url)).responseXML;
            this.path = new URL(url).pathname;
        }
        return this.dom.cloneNode(true);
    }

    /**
     * Checks whether the given URL matches the cached pathname.
     *
     * @param {string} url - The URL to test.
     * @returns {boolean} True when the cache can satisfy the request.
     */
    inCache(url) {
        return (((new URL(url).pathname) === this.path)
            && (this.dom !== null));
    }
}

/**
 * A Parser's state variables
*/
class ParserState {
    /**
     * Creates a fresh parser state container.
     *
     * @returns {void}
     */
    constructor() {
        this.webPages = new Map();
        this.chapterListUrl = null;
    }

    /**
     * Stores the chapter list in fetch order and links adjacent chapters together.
     *
     * @param {Array<Object>} urls - Chapter page metadata in order.
     * @returns {void}
     */
    setPagesToFetch(urls) {
        let nextPrevChapters = new Set();
        this.webPages = new Map();
        for (let i = 0; i < urls.length; ++i) {
            let page = urls[i];
            if (i < urls.length - 1) {
                nextPrevChapters.add(util.normalizeUrlForCompare(urls[i + 1].sourceUrl));
            }
            page.nextPrevChapters = nextPrevChapters;
            this.webPages.set(page.sourceUrl, page);
            nextPrevChapters = new Set();
            nextPrevChapters.add(util.normalizeUrlForCompare(page.sourceUrl));
        }
    }
}

/**
 * Core parser responsible for extracting chapters, metadata, and assets from web pages
 * and converting them into EPUB-ready items. Handles discovery of chapter URLs, fetching
 * and preprocessing chapter content, collecting images, normalizing titles, sanitizing
 * HTML, resolving internal hyperlinks, and updating UI/progress state. Supports custom
 * per-site parsing through subclass overrides and integrates user preferences (e.g.,
 * navigation link removal, author notes handling, and rate-limiting).
 *
 * @class Parser
 * @param {ImageCollector} [imageCollector] - Optional image collector; a new instance is created if omitted.
 */
class Parser {
    /**
     * Creates a parser with default throttling and state containers.
     *
     * @param {ImageCollector} [imageCollector] - Optional image collector override.
     * @returns {void}
     */
    constructor(imageCollector) {
        this.minimumThrottle = 500;
        this.maxSimultaneousFetchSize = 1;
        this.state = new ParserState();
        this.imageCollector = imageCollector || new ImageCollector();
        this.userPreferences = null;
        this.autoDelayAddedForCurrentStoryMs = 0;
    }

    /**
     * Copies parser state and user preferences from another parser instance.
     *
     * @param {Parser} otherParser - The parser to copy state from.
     * @returns {void}
     */
    copyState(otherParser) {
        this.state = otherParser.state;
        this.imageCollector.copyState(otherParser.imageCollector);
        this.userPreferences = otherParser.userPreferences;
    }

    /**
     * Replaces the current chapter list with a new ordered set of pages to fetch.
     *
     * @param {Array<Object>} urls - Chapter page metadata in fetch order.
     * @returns {void}
     */
    setPagesToFetch(urls) {
        this.state.setPagesToFetch(urls);
    }

    /**
     * Returns the current map of web pages scheduled for processing.
     *
     * @returns {Map<string, Object>} The pages queued for fetch and packaging.
     */
    getPagesToFetch() {
        return this.state.webPages;
    }

    /**
     * Allows a parser to treat a response as a custom error condition.
     *
     * Override in subclasses when the site signals errors through content instead of
     * HTTP status alone.
     *
     * @param {Response} response - The fetched response to inspect.
     * @returns {boolean} True when the response should be handled as a custom error.
     */
    isCustomError(response) {  // eslint-disable-line no-unused-vars
        return false;
    }

    /**
     * Builds a retryable custom error payload for sites that need special handling.
     *
     * @param {string} url - The target URL.
     * @param {Object} wrapOptions - Fetch wrapper options used for the request.
     * @param {Object} checkedresponse - The checked fetch response object.
     * @returns {Object} A custom error descriptor, or an empty object to fail fast.
     */
    setCustomErrorResponse(url, wrapOptions, checkedresponse) {
        //example
        let ret = {};
        ret.url = url;
        ret.wrapOptions = wrapOptions;
        ret.response = {};
        //URL that's get opened on 'Open URL for Captcha' click
        ret.response.url = checkedresponse.response.url;
        ret.response.status = 403;
        //How often should it be retried and with how much delay in between
        ret.response.retryDelay = [80, 40, 20, 10, 5];
        ret.errorMessage = "This is a custom error message that will be displayed should all retries fail";
        //return empty to throw error
        return {};
    }

    onUserPreferencesUpdate(userPreferences) {
        this.userPreferences = userPreferences;
        this.imageCollector.onUserPreferencesUpdate(userPreferences);
    }

    /**
     * Determines whether a web page has enough data to be converted into EPUB content.
     *
     * @param {Object} webPage - The page metadata and fetch result state.
     * @returns {boolean} True when the page should be packaged.
     */
    isWebPagePackable(webPage) {
        return ((webPage.isIncludeable)
            && ((webPage.rawDom != null) || (webPage.error != null)));
    }

    /**
     * Converts a fetched raw DOM into cleaned EPUB-ready chapter content.
     *
     * This is the main content normalization pipeline for chapter pages.
     *
     * @param {Object} webPage - The page metadata and raw DOM source.
     * @returns {HTMLElement|null} The sanitized chapter content element, or null.
     */
    convertRawDomToContent(webPage) {
        let content = this.findContent(webPage.rawDom);
        this.customRawDomToContentStep(webPage, content);
        util.decodeCloudflareProtectedEmails(content);
        if (this.userPreferences.removeNextAndPreviousChapterHyperlinks.value) {
            this.removeNextAndPreviousChapterHyperlinks(webPage, content);
        }
        this.removeUnwantedElementsFromContentElement(content);
        this.replaceWpBlockSpacersWithHR(content);
        this.addTitleToContent(webPage, content);
        util.fixBlockTagsNestedInInlineTags(content);
        this.imageCollector.replaceImageTags(content);
        util.removeUnusedHeadingLevels(content);
        util.makeHyperlinksRelative(webPage.rawDom.baseURI, content);
        util.setStyleToDefault(content);
        util.prepForConvertToXhtml(content);
        util.removeEmptyAttributes(content);
        util.removeSpansWithNoAttributes(content);
        util.removeEmptyDivElements(content);
        util.removeTrailingWhiteSpace(content);
        util.trimTextContent(content);
        util.ensureSingleNewlineBetweenParagraphs(content);
        if (util.isElementWhiteSpace(content)) {
            let errorMsg = UIText.Warning.warningNoVisibleContent(webPage.sourceUrl);
            ErrorLog.showErrorMessage(errorMsg);
        }
        return content;
    }

    /**
     * Inserts a normalized chapter title into the content when the page does not already expose one.
     *
     * @param {Object} webPage - The chapter metadata being converted.
     * @param {HTMLElement} content - The chapter content element.
     * @returns {void}
     */
    addTitleToContent(webPage, content) {
        let title = this.findChapterTitle(webPage.rawDom, webPage);
        if (title != null) {
            if (title instanceof HTMLElement) {
                title = title.textContent;
            }
            title = this.normalizeChapterTitle(title);
            if (webPage.title == "[placeholder]") {
                webPage.title = title;
            }
            if (!this.titleAlreadyPresent(title, content)) {
                let titleElement = webPage.rawDom.createElement("h1");
                titleElement.appendChild(webPage.rawDom.createTextNode(title));
                content.insertBefore(titleElement, content.firstChild);
            }
            this.removeDuplicateLeadingChapterTitles(content, title);
        } else {
            if (webPage.title == "[placeholder]") {
                webPage.title = this.normalizeChapterTitle(webPage.rawDom.title);
            }
        }
    }

    /**
     * Checks whether the chapter title is already present as a leading heading.
     *
     * @param {string} title - The normalized chapter title.
     * @param {HTMLElement} content - The chapter content element.
     * @returns {boolean} True when a matching heading already exists.
     */
    titleAlreadyPresent(title, content) {
        let existingTitle = content.querySelector("h1, h2, h3, h4, h5, h6");
        return (existingTitle != null)
            && (Parser.normalizeWhitespace(title) === Parser.normalizeWhitespace(existingTitle.textContent));
    }

    /**
     * Hook for subclasses to locate the chapter title element or text.
     *
     * @param {Document|Element} dom - The DOM to inspect.
     * @returns {string|HTMLElement|null} The chapter title, if found.
     */
    findChapterTitle(dom) {   // eslint-disable-line no-unused-vars
        return null;
    }

    /**
     * Replaces WordPress spacer blocks with semantic horizontal rules.
     *
     * @param {HTMLElement} content - The chapter content element.
     * @returns {void}
     */
    replaceWpBlockSpacersWithHR(content) {
        [...content.querySelectorAll("div.wp-block-spacer")].forEach(
            e => e.replaceWith(content.ownerDocument.createElement("hr"))
        );
    }

    /**
     * Normalizes a chapter title by collapsing whitespace and standardizing numbering prefixes.
     *
     * @param {string} title - The raw chapter title.
     * @returns {string} The normalized title.
     */
    normalizeChapterTitle(title) {
        let normalized = Parser.normalizeWhitespace(title);
        let stripped = Parser.stripLeadingAggregateChapterCount(normalized);
        return Parser.standardizeChapterTitleSeparator(stripped);
    }

    /**
     * Collapses repeated whitespace into single spaces and trims the result.
     *
     * @param {string|null|undefined} text - The text to normalize.
     * @returns {string} The whitespace-normalized text.
     */
    static normalizeWhitespace(text) {
        return (text ?? "").replace(/\s+/g, " ").trim();
    }

    /**
     * Removes a leading aggregate chapter count when the remaining text still looks like a chapter title.
     *
     * @param {string} title - The title to inspect.
     * @returns {string} The title without a leading aggregate count when appropriate.
     */
    static stripLeadingAggregateChapterCount(title) {
        let match = Parser.LEADING_AGGREGATE_CHAPTER_REGEX.exec(title);
        if (match && match.groups?.rest) {
            let rest = Parser.normalizeWhitespace(match.groups.rest);
            if (Parser.containsChapterNumber(rest) || Parser.isCommonChapterName(rest)) {
                return rest;
            }
        }
        return title;
    }

    /**
     * Standardizes the separator after a leading chapter number.
     * Ensures "1: Title" or "1 - Title" format.
     * @param {string} title
     * @returns {string}
     */
    static standardizeChapterTitleSeparator(title) {
        let match = /^(\s*(?:chapter|chap(?:ter)?|ch|episode|ep|part)?\s*(?:[ivxlcdm]+|\d+(?:\.\d+)?))\s*(:)\s*(.+)$/i.exec(title);
        if (match) {
            return `${match[1]}: ${match[3].trim()}`;
        }
        match = /^(\s*(?:chapter|chap(?:ter)?|ch|episode|ep|part)?\s*(?:[ivxlcdm]+|\d+(?:\.\d+)?))\s*([-–—])\s*(.+)$/i.exec(title);
        if (match) {
            return `${match[1]} ${match[2]} ${match[3].trim()}`;
        }
        return title;
    }

    /**
     * Detects whether a title begins with a chapter number or chapter-like prefix.
     *
     * @param {string} title - The title to inspect.
     * @returns {boolean} True when the title appears to include a chapter number.
     */
    static containsChapterNumber(title) {
        let normalized = Parser.normalizeWhitespace(title);
        let match = Parser.CHAPTER_NUMBER_REGEX.exec(normalized);
        if (!match) {
            return false;
        }
        return match.index <= Parser.CHAPTER_NUMBER_MAX_OFFSET;
    }

    /**
     * Detects common non-numeric chapter names such as prologue or epilogue.
     *
     * @param {string} title - The title to inspect.
     * @returns {boolean} True when the title matches a common chapter label.
     */
    static isCommonChapterName(title) {
        let normalized = Parser.normalizeWhitespace(title).toLowerCase();
        return Parser.COMMON_CHAPTER_NAME_REGEX.test(normalized);
    }

    /**
     * Removes duplicate leading chapter titles when the same title is repeated in the content body.
     *
     * @param {HTMLElement} content - The chapter content element.
     * @param {string} title - The chapter title to deduplicate.
     * @returns {void}
     */
    removeDuplicateLeadingChapterTitles(content, title) {
        if (!content || util.isNullOrEmpty(title)) {
            return;
        }
        let normalizedTitle = Parser.normalizeWhitespace(title).toLowerCase();
        let seen = false;
        let node = content.firstChild;
        while (node) {
            if ((node.nodeType === Node.TEXT_NODE) && util.isStringWhiteSpace(node.textContent)) {
                node = node.nextSibling;
                continue;
            }
            let nodeText = Parser.normalizeWhitespace(node.textContent || "").toLowerCase();
            if (nodeText === normalizedTitle) {
                if (seen) {
                    let toRemove = node;
                    node = node.nextSibling;
                    toRemove.remove();
                    continue;
                }
                seen = true;
                node = node.nextSibling;
                continue;
            }
            break;
        }
    }

    /**
     * Sanitizes a content element by removing scriptable elements, comments, unwanted WordPress and Microsoft artifacts, share links, and leading whitespace.
     *
     * @param {Element} element - The content element to clean.
     * @returns {void}
     */
    removeUnwantedElementsFromContentElement(element) {
        util.removeScriptableElements(element);
        util.removeComments(element);
        util.removeElements(element.querySelectorAll("noscript, input"));
        util.removeUnwantedWordpressElements(element);
        util.removeMicrosoftWordCrapElements(element);
        util.removeShareLinkElements(element);
        util.removeLeadingWhiteSpace(element);
    }

    /**
     * Allows subclasses to perform custom processing on raw DOM content before it is converted.
     *
     * @param {Object} chapter - Chapter metadata or context for the current processing step.
     * @param {Document|HTMLElement} content - The raw DOM content to be inspected or transformed.
     * @returns {void}
     */
    customRawDomToContentStep(chapter, content) { // eslint-disable-line no-unused-vars
        // override for any custom processing
    }

    /**
     * Updates the parser UI with cover image options and any implementation-specific fields.
     *
     * @param {Document|HTMLElement} dom - The parsed document or DOM root used to locate cover images and populate the UI.
     * @returns {void}
     */
    populateUI(dom) {
        CoverImageUI.showCoverImageUrlInput(true);
        let coverUrl = this.findCoverImageUrl(dom);
        CoverImageUI.setCoverImageUrl(coverUrl);
        this.populateUIImpl();
    }

    /**
     * Populates additional UI elements for the parser.
     *
     * Default implementation performs no actions.
     * Override in subclasses to add custom UI components or logic.
     *
     * @returns {void}
     */
    populateUIImpl() {
        // default implementation is do nothing more
    }

    /**
     * Default implementation is to take the first image in content section.
     *
     * @param {Document|Element|null} dom - The DOM node to search for the cover image.
     * @returns {string|null} The cover image URL if found, otherwise `null`.
     */
    findCoverImageUrl(dom) {
        if (dom != null) {
            let content = this.findContent(dom);
            if (content != null) {
                let cover = content.querySelector("img");
                if (cover != null) {
                    return cover.src;
                }
            }
        }
        return null;
    }

    /**
     * Removes detected "next" and "previous" chapter navigation links from the given element.
     * Finds chapter navigation anchors within `element`, optionally resolves each link to a
     * parent node via `findParentNodeOfChapterLinkToRemoveAt`, removes nearby navigation cues,
     * deletes the collected nodes, and then cleans up any empty navigation containers.
     *
     * @param {Document|HTMLElement} webPage - The web page context used to identify navigation links.
     * @param {HTMLElement|null} element - The root element in which to search for chapter navigation links.
     * @returns {void}
     */
    removeNextAndPreviousChapterHyperlinks(webPage, element) {
        if (element == null) {
            return;
        }
        let elementToRemove = (this.findParentNodeOfChapterLinkToRemoveAt != null) ?
            this.findParentNodeOfChapterLinkToRemoveAt.bind(this)
            : (node) => node;

        let navigationLinks = [...element.querySelectorAll("a")]
            .filter(link => this.isChapterNavigationLink(link, webPage));

        let nodesToRemove = new Set();
        for (let link of navigationLinks) {
            Parser.removeNavigationCueSiblings(link);
            nodesToRemove.add(elementToRemove(link));
        }
        util.removeElements([...nodesToRemove]);
        Parser.removeEmptyNavigationContainers(element);
    }

    /**
     * Determines whether a given link is a chapter navigation link.
     *
     * Checks if the link's normalized `href` exists in the `webPage.nextPrevChapters`
     * collection, or if the link's label matches a known navigation cue (e.g., "next",
     * "previous").
     *
     * @param {HTMLAnchorElement | null} link - The link element to inspect.
     * @param {{ nextPrevChapters: Set<string> }} webPage - The web page context containing known chapter navigation URLs.
     * @returns {boolean} `true` if the link is identified as a chapter navigation link; otherwise, `false`.
     */
    isChapterNavigationLink(link, webPage) {
        if (!link) {
            return false;
        }
        let href = link.href;
        if (!util.isNullOrEmpty(href)) {
            let normalized = util.normalizeUrlForCompare(href);
            if (webPage.nextPrevChapters.has(normalized)) {
                return true;
            }
        }
        return Parser.isNavigationCueText(Parser.getNavigationLabel(link));
    }

    /**
     * Default implementation turns each web page into a single EPUB item.
     *
     * @param {Object} webPage - The web page metadata being converted.
     * @param {number} epubItemIndex - The target index for the generated EPUB item.
     * @returns {ChapterEpubItem[]} A single-item array containing the converted chapter.
     */
    webPageToEpubItems(webPage, epubItemIndex) {
        let content = this.convertRawDomToContent(webPage);
        let items = [];
        if (content != null) {
            items.push(new ChapterEpubItem(webPage, content, epubItemIndex));
        }
        return items;
    }

    /**
     * Creates a placeholder chapter entry for a failed or pending web page.
     *
     * Builds an empty document for the given source URL, populates it with a
     * localized placeholder message (including any error information), converts
     * `<pre>` tags to `<p>` tags for proper formatting, and wraps the result in a
     * `ChapterEpubItem`.
     *
     * @param {Object} webPage - The web page metadata containing `sourceUrl` and optional `error` details.
     * @param {number} epubItemIndex - The position at which the placeholder chapter should be inserted.
     * @returns {ChapterEpubItem[]} An array containing the single placeholder `ChapterEpubItem`.
     */
    makePlaceholderEpubItem(webPage, epubItemIndex) {
        let temp = Parser.makeEmptyDocForContent(webPage.sourceUrl);
        temp.content.textContent = UIText.Default.chapterPlaceholderMessage(webPage.sourceUrl, webPage.error);
        util.convertPreTagToPTags(temp.dom, temp.content);
        return [new ChapterEpubItem(webPage, temp.content, epubItemIndex)];
    }

    /**
     * Extracts a title from the provided DOM, preferring the `og:title` meta content and falling back to the document title.
     *
     * Default Implementation
     * @default
     *
     * @param {Document} dom - The HTML document to read the title from.
     * @returns {string} The extracted title.
     */
    static extractTitleDefault(dom) {
        let title = dom.querySelector("meta[property='og:title']");
        return (title === null) ? dom.title : title.getAttribute("content");
    }

    /**
     * Extracts the title from the provided DOM using the default parser strategy.
     *
     * @param {Document} dom - The DOM document to extract the title from.
     * @returns {string} The extracted title text.
     */
    extractTitleImpl(dom) {
        return Parser.extractTitleDefault(dom);
    }

    /**
     * Extracts a cleaned title from the provided DOM by first attempting a
     * parser-specific implementation and falling back to a default extractor.
     * Strips any leading “[NSFW]” tag and trims whitespace before returning.
     *
     * @param {Document} dom - The DOM from which to extract the title.
     * @returns {string} The sanitized title text.
     */
    extractTitle(dom) {
        let title = this.extractTitleImpl(dom);
        if (title == null) {
            title = Parser.extractTitleDefault(dom);
        }
        if (title.textContent !== undefined) {
            title = title.textContent;
        }
        title = title.replace(/\[NSFW\]\s+/, "");
        return title.trim();
    }

    /**
     * Extracts the author's name from the provided DOM structure.
     *
     * Default Implementation
     * @default
     *
     * @param {Document|Element} dom - The DOM from which to extract the author information.
     * @returns {string} The extracted author name, or the default "<unknown>" placeholder if not found.
     */
    extractAuthor(dom) {  // eslint-disable-line no-unused-vars
        return "<unknown>";
    }

    /**
     * Extracts a locale code from the provided DOM by first checking the `og:locale`
     * meta tag, then falling back to the `<html>` element's `lang` attribute,
     * returning `"en"` if neither is found.
     *
     * Default Implementation - if not available, default to English
     * @default
     *
     * @param {Document} dom - The DOM document to inspect for language metadata.
     * @returns {string} The detected locale code or `"en"` if none is specified.
     */
    extractLanguage(dom) {
        // try jetpack tag
        let locale = dom.querySelector("meta[property='og:locale']");
        if (locale !== null) {
            return locale.getAttribute("content");
        }

        // try <html>'s lang attribute
        locale = dom.querySelector("html").getAttribute("lang") ?? "en";
        return locale.split("-")[0];
    }

    /**
    * default implementation,
    * if not available, return ''
    */
    extractSubject(dom) {   // eslint-disable-line no-unused-vars
        return "";
    }

    /**
     * Extracts descriptive text from the DOM, using the info-page nodes when available.
     *
     * @param {Document|Element} dom - The DOM to inspect for description content.
     * @returns {string} The extracted description text.
     */
    extractDescription(dom) {
        let infoDiv = document.createElement("div");
        if (this.getInformationEpubItemChildNodes !== undefined) {
            this.populateInfoDiv(infoDiv, dom);
        }
        return infoDiv.textContent;
    }

    /**
     * Normalizes description text from a string or DOM node into a compact single-line string.
     *
     * @param {string|Node|null|undefined} description - The raw description value.
     * @returns {string} The normalized description text.
     */
    normalizeDescriptionText(description) {
        if (description == null) {
            return "";
        }
        let text = (typeof description === "string")
            ? description
            : (typeof description.textContent === "string")
                ? description.textContent
                : String(description ?? "");
        let collapsed = text.replace(/\s+/g, " ");
        return collapsed.trim();
    }

    /**
     * Populates series-related metadata fields.
     *
     * Default implementation does nothing. Override in subclasses that expose series data.
     *
     * @param {Document|Element} dom - The DOM containing series metadata.
     * @param {EpubMetaInfo} metaInfo - The metadata object to update.
     * @returns {void}
     */
    extractSeriesInfo(dom, metaInfo) {  // eslint-disable-line no-unused-vars
    }

    /**
     * Loads EPUB metadata asynchronously when a parser needs a separate metadata pass.
     *
     * Default implementation performs no work.
     *
     * @param {Document|Element} dom - The DOM document or element to inspect.
     * @returns {Promise<void>}
     */
    async loadEpubMetaInfo(dom) {  // eslint-disable-line no-unused-vars
        return;
    }

    /**
     * Builds a fully populated metadata object for EPUB generation.
     *
     * @param {Document} dom - The DOM document to inspect.
     * @param {boolean} useFullTitle - Whether to preserve a longer file name.
     * @returns {EpubMetaInfo} The populated metadata container.
     */
    getEpubMetaInfo(dom, useFullTitle) {
        let metaInfo = new EpubMetaInfo();
        metaInfo.uuid = dom.baseURI;
        try {
            metaInfo.title = this.extractTitle(dom);
        }
        catch (err) {
            metaInfo.title = "";
        }
        try {
            metaInfo.author = this.extractAuthor(dom).trim();
        }
        catch (err) {
            metaInfo.author = "";
        }
        try {
            metaInfo.language = this.extractLanguage(dom);
        }
        catch (err) {
            metaInfo.language = "";
        }
        try {
            metaInfo.fileName = this.makeSaveAsFileNameWithoutExtension(metaInfo.title, useFullTitle, true);
        }
        catch (err) {
            metaInfo.fileName = "web.epub";
        }
        try {
            metaInfo.subject = this.extractSubject(dom);
        }
        catch (err) {
            metaInfo.subject = "";
        }
        try {
            metaInfo.description = this.normalizeDescriptionText(this.extractDescription(dom));
        }
        catch (err) {
            metaInfo.description = "";
        }
        this.extractSeriesInfo(dom, metaInfo);
        return metaInfo;
    }

    /**
     * Creates a single-chapter story definition from the given base URL and DOM.
     *
     * @param {string} baseUrl - The source URL for the chapter.
     * @param {Document} dom - The DOM used to extract the title.
     * @returns {Array<{sourceUrl: string, title: string}>} A one-item chapter list.
     */
    singleChapterStory(baseUrl, dom) {
        return [{
            sourceUrl: baseUrl,
            title: this.extractTitle(dom)
        }];
    }

    /**
     * Reads the first `<base>` element in the DOM and returns its resolved href.
     *
     * @param {Document} dom - The DOM document containing the base tag.
     * @returns {string} The base URL used to resolve relative links.
     */
    getBaseUrl(dom) {
        return Array.from(dom.getElementsByTagName("base"))[0].href;
    }

    /**
     * Generates a sanitized filename (without extension) based on a title.
     *
     * Truncates or leaves the title depending on `useFullTitle` (20 characters by default,
     * 512 when true), replacing unsafe characters with a filesystem-safe variant. If the
     * title is null, defaults to "web" (unless skipWebDefault is true). If the sanitized
     * result is only whitespace, returns the original title (useful for non-English titles).
     *
     * @param {string|null} title - The original title to base the filename on; may be null.
     * @param {boolean} useFullTitle - Whether to allow a longer filename (up to 512 chars).
     * @param {boolean} [skipWebDefault=false] - When true, returns empty string instead of "web" when title is null.
     * @returns {string} The sanitized filename without an extension.
     */
    makeSaveAsFileNameWithoutExtension(title, useFullTitle, skipWebDefault = false) {
        let maxFileNameLength = useFullTitle ? 512 : 20;
        let fileName = (title == null) ? (skipWebDefault ? "" : "web") : util.safeForFileName(title, maxFileNameLength);
        if (util.isStringWhiteSpace(fileName)) {
            // title is probably not English, so just use it as is
            fileName = title;
        }
        return fileName;
    }

    /**
     * Creates an {@link EpubItemSupplier} initialized with the current web pages,
     * converting them to EPUB items and normalizing hyperlinks before supplying them.
     *
     * @returns {EpubItemSupplier} A supplier configured with processed EPUB items and image collector.
     */
    epubItemSupplier() {
        let epubItems = this.webPagesToEpubItems([...this.state.webPages.values()]);
        this.fixupHyperlinksInEpubItems(epubItems);
        return new EpubItemSupplier(this, epubItems, this.imageCollector);
    }

    /**
     * Converts an array of web page objects into an ordered list of EPUB items.
     *
     * Optionally prepends an information page based on user preferences. Iterates over
     * packable web pages, delegating to each page's parser when no error is present or
     * generating placeholder items on error. Each generated item's index is tracked and
     * raw DOM data is discarded after processing.
     *
     * @param {Array<Object>} webPages - Collection of web page objects to convert.
     * @returns {Array<Object>} Ordered EPUB items derived from the provided web pages.
     */
    webPagesToEpubItems(webPages) {
        let epubItems = [];
        let index = 0;

        if (this.userPreferences.addInformationPage.value &&
            this.getInformationEpubItemChildNodes !== undefined) {
            epubItems.push(this.makeInformationEpubItem(this.state.firstPageDom));
            ++index;
        }

        for (let webPage of webPages.filter(c => this.isWebPagePackable(c))) {
            let newItems = (webPage.error == null)
                ? webPage.parser.webPageToEpubItems(webPage, index)
                : this.makePlaceholderEpubItem(webPage, index);
            epubItems = epubItems.concat(newItems);
            index += newItems.length;
            delete (webPage.rawDom);
        }
        return epubItems;
    }

    /**
     * Creates an information EPUB chapter that includes the table-of-contents URL and
     * metadata extracted from the provided DOM.
     *
     * @param {Document|HTMLElement} dom - The DOM containing additional info to populate the info section.
     * @returns {ChapterEpubItem} The constructed information chapter ready to be included in the EPUB.
     */
    makeInformationEpubItem(dom) {
        let titleText = UIText.Default.informationPageTitle;
        let title = document.createElement("h1");
        title.appendChild(document.createTextNode(titleText));
        let div = document.createElement("div");
        let urlElement = document.createElement("p");
        let bold = document.createElement("b");
        bold.textContent = UIText.Default.tableOfContentsUrl;
        urlElement.appendChild(bold);
        urlElement.appendChild(document.createTextNode(this.state.chapterListUrl));
        div.appendChild(urlElement);
        let infoDiv = document.createElement("div");
        this.populateInfoDiv(infoDiv, dom);
        let childNodes = [title, div, infoDiv];
        let chapter = {
            sourceUrl: this.state.chapterListUrl,
            title: titleText,
            newArch: null
        };
        return new ChapterEpubItem(chapter, { childNodes: childNodes }, 0);
    }

    /**
     * Populates the information page container with sanitized custom nodes.
     *
     * @param {HTMLElement} infoDiv - The information container to populate.
     * @param {Document|HTMLElement} dom - The DOM used to supply information nodes.
     * @returns {void}
     */
    populateInfoDiv(infoDiv, dom) {
        for (let n of this.getInformationEpubItemChildNodes(dom).filter(n => n != null)) {
            let clone = util.sanitizeNode(n);
            if (clone) {
                this.cleanInformationNode(clone);
            }
            if (clone != null) {
                infoDiv.appendChild(clone);
            }
        }
        // this "page" doesn't go through image collector, so strip images
        util.removeChildElementsMatchingSelector(infoDiv, "img");
        // this "page" doesn't go through image collector, so strip SVGs
        util.removeChildElementsMatchingSelector(infoDiv, "svg");
    }

    /**
     * Hook method for subclasses to sanitize or transform an information node.
     * Override in derived classes to implement custom cleanup logic.
     *
     * @override
     *
     * @param {Node} node - The information DOM node to be cleaned.
     */
    cleanInformationNode(node) {     // eslint-disable-line no-unused-vars
        // do nothing, derived class overrides as required
    }

    /**
     * Handles the first loaded page by building the chapter list and wiring the UI.
     *
     * @param {string} url - The first page URL.
     * @param {Document} firstPageDom - The DOM for the first page.
     * @returns {Promise<void>} Resolves once the chapter list has been prepared.
     */
    async onLoadFirstPage(url, firstPageDom) {
        this.state.firstPageDom = firstPageDom;
        this.state.chapterListUrl = url;
        let chapterUrlsUI = new ChapterUrlsUI(this);
        this.userPreferences.setReadingListCheckbox(url);

        try {
            let chapters = await this.getChapterUrls(firstPageDom, chapterUrlsUI);
            if (this.userPreferences.chaptersPageInChapterList.value) {
                chapters = this.addFirstPageUrlToWebPages(url, firstPageDom, chapters);
            }
            chapters = this.cleanWebPageUrls(chapters);
            chapters?.forEach(chapter => chapter.title = this.normalizeChapterTitle(chapter.title));
            await this.userPreferences.readingList.deselectOldChapters(url, chapters);
            chapterUrlsUI.populateChapterUrlsTable(chapters);
            if (0 < chapters.length) {
                if (chapters[0].sourceUrl === url) {
                    chapters[0].rawDom = firstPageDom;
                    this.updateLoadState(chapters[0]);
                }
                ProgressBar.setValue(0);
            }
            this.state.setPagesToFetch(chapters);
            chapterUrlsUI.connectButtonHandlers();
        } catch (err) {
            ErrorLog.showErrorMessage(err);
        }
    }

    /**
     * Filters and normalizes an array of web page objects by:
     * - Converting Imgur gallery URLs to direct links.
     * - Retaining only entries with valid URLs.
     * - Removing duplicate entries based on `sourceUrl`.
     *
     * @param {Array<{sourceUrl: string}>} webPages - Collection of web page objects to be cleaned.
     * @returns {Array<{sourceUrl: string}>} A new array containing unique web pages with valid, normalized URLs.
     */
    cleanWebPageUrls(webPages) {
        let foundUrls = new Set();
        let isUnique = function(webPage) {
            let unique = !foundUrls.has(webPage.sourceUrl);
            if (unique) {
                foundUrls.add(webPage.sourceUrl);
            }
            return unique;
        };

        return webPages
            .map(this.fixupImgurGalleryUrl)
            .filter(p => util.isUrl(p.sourceUrl))
            .filter(isUnique);
    }

    /**
     * Updates the given web page object by normalizing its Imgur gallery source URL.
     *
     * @param {Object} webPage - The web page metadata object containing a `sourceUrl` to fix.
     * @returns {Object} The updated web page object with its `sourceUrl` corrected for Imgur galleries.
     */
    fixupImgurGalleryUrl(webPage) {
        webPage.sourceUrl = Imgur.fixupImgurGalleryUrl(webPage.sourceUrl);
        return webPage;
    }

    /**
     * Ensures the first page URL is present in the chapter list when it is not already included.
     *
     * @param {string} url - The first-page URL.
     * @param {Document} firstPageDom - The DOM for the first page.
     * @param {Array<Object>} webPages - The existing chapter list.
     * @returns {Array<Object>} The chapter list with the first page prepended when needed.
     */
    addFirstPageUrlToWebPages(url, firstPageDom, webPages) {
        let present = webPages.find(e => e.sourceUrl === url);
        if (present) {
            return webPages;
        } else {
            return [{
                sourceUrl: url,
                title: this.extractTitle(firstPageDom)
            }].concat(webPages);
        }
    }

    /**
     * Handles the fetch-chapters button by either surfacing an error or starting fetch work.
     *
     * @returns {void}
     */
    onFetchChaptersClicked() {
        if (0 == this.state.webPages.size) {
            ErrorLog.showErrorMessage(UIText.Error.noChaptersFoundAndFetchClicked);
        } else {
            this.fetchWebPages();
        }
    }

    /**
     * Alias used by callers that expect a content-fetching entry point.
     *
     * @returns {Promise<void>} The underlying fetch operation.
     */
    fetchContent() {
        return this.fetchWebPages();
    }

    /**
     * Updates the UI to reflect that chapter loading has started.
     *
     * @param {number} length - The number of pages queued for loading.
     * @returns {void}
     */
    setUiToShowLoadingProgress(length) {
        main.getPackEpubButton().disabled = true;
        ProgressBar.setMax(length + 1);
        ProgressBar.setValue(1);
    }

    /**
     * Fetches all includeable web pages, updating UI progress and managing cover image state.
     * Groups pages to fetch and retrieves their content in batches until completion or abortion.
     * Rejects if no chapters are found, logs errors on failure.
     *
     * @async
     * @returns {Promise<void>} Resolves when all page fetches are complete; rejects on absence of chapters or errors.
     */
    async fetchWebPages() {
        let pagesToFetch = [...this.state.webPages.values()].filter(c => c.isIncludeable);
        if (pagesToFetch.length === 0) {
            return Promise.reject(new Error("No chapters found."));
        }

        this.setUiToShowLoadingProgress(pagesToFetch.length);

        this.imageCollector.reset();
        this.imageCollector.setCoverImageUrl(CoverImageUI.getCoverImageUrl());

        await this.addParsersToPages(pagesToFetch);
        let index = 0;
        try {
            let group = this.groupPagesToFetch(pagesToFetch, index);
            while (0 < group.length) {
                await Promise.all(group.map(async (webPage) => this.fetchWebPageContent(webPage)));
                index += group.length;
                group = this.groupPagesToFetch(pagesToFetch, index);
                if (util.sleepController.signal.aborted) {
                    break;
                }
            }
        } catch (err) {
            ErrorLog.log(err);
        }
    }

    /**
     * Assigns parser instances to the chapter list before fetch starts.
     *
     * @param {Array<Object>} pagesToFetch - Chapter metadata awaiting parser assignment.
     * @returns {Promise<void>}
     */
    async addParsersToPages(pagesToFetch) {
        parserFactory.addParsersToPages(this, pagesToFetch);
    }

    /**
     * Returns the current batch of pages that should be fetched together.
     *
     * @param {Array<Object>} webPages - The full page list.
     * @param {number} index - The starting index for this batch.
     * @returns {Array<Object>} The next fetch batch.
     */
    groupPagesToFetch(webPages, index) {
        return webPages.slice(index, index + this.maxSimultaneousFetchSize);
    }

    /**
     * Fetches, preprocesses, and image-scans a single web page.
     *
     * @param {Object} webPage - The web page metadata to fetch.
     * @returns {Promise<void>} Resolves when the page has been processed.
     */
    async fetchWebPageContent(webPage) {
        ChapterUrlsUI.showDownloadState(webPage.row, ChapterUrlsUI.DOWNLOAD_STATE_SLEEPING);
        await this.rateLimitDelay();
        ChapterUrlsUI.showDownloadState(webPage.row, ChapterUrlsUI.DOWNLOAD_STATE_DOWNLOADING);
        let pageParser = webPage.parser;
        try {
            let webPageDom = await pageParser.fetchChapter(webPage.sourceUrl);
            delete webPage.error;
            webPage.rawDom = webPageDom;
            await pageParser.preprocessRawDom(webPageDom);
            pageParser.removeUnusedElementsToReduceMemoryConsumption(webPageDom);
            let content = pageParser.findContent(webPage.rawDom);
            if (content == null) {
                let errorMsg = UIText.Error.errorContentNotFound(webPage.sourceUrl);
                throw new Error(errorMsg);
            }
            return pageParser.fetchImagesUsedInDocument(content, webPage);
        } catch (error) {
            if (this.userPreferences.skipChaptersThatFailFetch.value) {
                ErrorLog.log(error);
                webPage.error = error;
            } else {
                webPage.isIncludeable = false;
                throw error;
            }
        }
    }

    /**
     * Processes the provided document content to collect and fetch all referenced images,
     * then updates the load state for the given web page.
     *
     * @async
     * @param {string} content - The HTML content of the document to scan for image references.
     * @param {{ sourceUrl: string }} webPage - The web page metadata containing the source URL used to resolve images.
     * @returns {Promise<void>} Resolves once all images are processed and the page load state is updated.
     */
    async fetchImagesUsedInDocument(content, webPage) {
        let revisedContent = await this.imageCollector.preprocessImageTags(content, webPage.sourceUrl);
        this.imageCollector.findImagesUsedInDocument(revisedContent);
        await this.imageCollector.fetchImages(() => { }, webPage.sourceUrl);
        this.updateLoadState(webPage);
    }

    /**
     * derived classes override if need to do something to fetched DOM before
     * normal processing steps
     *
     * Default Implementation
     * @default
     *
     * @override
     * @param {Document|Element} webPageDom - The DOM document or root element to preprocess.
     * @returns {void}
     */
    preprocessRawDom(webPageDom) { } // eslint-disable-line no-unused-vars

    /**
     * Removes unused `<select>` and `<iframe>` elements from the provided DOM to reduce memory consumption.
     *
     * @param {Document|Element} webPageDom - The DOM document or root element to clean up.
     * @returns {void}
     */
    removeUnusedElementsToReduceMemoryConsumption(webPageDom) {
        util.removeElements(webPageDom.querySelectorAll("select, iframe"));
    }

    /**
     * Fetches a chapter page and returns the XML/DOM response.
     *
     * Override when a site requires special request handling.
     *
     * @param {string} url - The chapter URL to fetch.
     * @returns {Promise<Document>} The fetched response XML.
     */
    async fetchChapter(url) {
        return (await HttpClient.wrapFetch(url, { storyUrl: this.state.chapterListUrl })).responseXML;
    }

    /**
     * Writes the current chapter list back to the reading list UI/state.
     *
     * @returns {void}
     */
    updateReadingList() {
        this.userPreferences.readingList.update(
            this.state.chapterListUrl,
            [...this.state.webPages.values()]
        );
    }

    /**
     * Marks the current page row as fully loaded in the chapter list UI.
     *
     * @param {Object} webPage - The page metadata whose row should be updated.
     * @returns {void}
     */
    updateLoadState(webPage) {
        ChapterUrlsUI.showDownloadState(webPage.row, ChapterUrlsUI.DOWNLOAD_STATE_LOADED);
        ProgressBar.updateValue(1);
    }

    /**
     * Hook point invoked when the user presses "Pack EPUB".
     *
     * Override in subclasses that need to prepare state before packaging begins.
     *
     * @returns {void}
     */
    onStartCollecting() { }

    /**
     * Rewrites unresolved EPUB hyperlinks so they point at EPUB-local targets or absolute URLs.
     *
     * @param {Array<ChapterEpubItem>} epubItems - The EPUB items to scan and update.
     * @returns {void}
     */
    fixupHyperlinksInEpubItems(epubItems) {
        let targets = this.sourceUrlToEpubItemUrl(epubItems);
        for (let item of epubItems) {
            for (let link of item.getHyperlinks().filter(this.isUnresolvedHyperlink)) {
                if (!this.hyperlinkToEpubItemUrl(link, targets)) {
                    this.makeHyperlinkAbsolute(link);
                }
            }
        }
    }

    /**
     * Builds a lookup from source URLs to EPUB-relative item URLs.
     *
     * @param {Array<ChapterEpubItem>} epubItems - The EPUB items to index.
     * @returns {Map<string, string>} A normalized source URL to EPUB href map.
     */
    sourceUrlToEpubItemUrl(epubItems) {
        let targets = new Map();
        for (let item of epubItems) {
            let key = util.normalizeUrlForCompare(item.sourceUrl);

            // Some source URLs may generate multiple epub items.
            // In that case, want FIRST epub item
            if (!targets.has(key)) {
                targets.set(key, util.makeRelative(item.getZipHref()));
            }
        }
        return targets;
    }

    /**
     * Checks whether a hyperlink still needs EPUB URL resolution.
     *
     * @param {HTMLAnchorElement} link - The hyperlink to inspect.
     * @returns {boolean} True when the link is unresolved and should be rewritten.
     */
    isUnresolvedHyperlink(link) {
        let href = link.getAttribute("href");
        if (href == null) {
            return false;
        }
        return !href.startsWith("#") &&
            !href.startsWith("../Text/");
    }

    /**
     * Rewrites a hyperlink to point at the matching EPUB item when available.
     *
     * @param {HTMLAnchorElement} link - The hyperlink to rewrite.
     * @param {Map<string, string>} targets - Normalized source URL to EPUB href mapping.
     * @returns {boolean} True when the link mapped to an EPUB item.
     */
    hyperlinkToEpubItemUrl(link, targets) {
        let key = util.normalizeUrlForCompare(link.href);
        let targetInEpub = targets.has(key);
        if (targetInEpub) {
            link.href = targets.get(key) + link.hash;
        }
        return targetInEpub;
    }

    /**
     * Converts a hyperlink to an absolute URL when it is still relative.
     *
     * @param {HTMLAnchorElement} link - The hyperlink to update.
     * @returns {void}
     */
    makeHyperlinkAbsolute(link) {
        if (link.href !== link.getAttribute("href")) {
            link.href = link.href;       // eslint-disable-line no-self-assign
        }
    }

    /**
     * Returns a parser-disabled placeholder for sites that are not implemented.
     *
     * @returns {null}
     */
    disabled() {
        return null;
    }

    /**
     * Produces the best available navigation label from link text and ARIA attributes.
     *
     * @param {HTMLAnchorElement|null} link - The link to inspect.
     * @returns {string} The combined navigation label.
     */
    static getNavigationLabel(link) {
        if (!link) {
            return "";
        }
        let labels = [];
        if (!util.isNullOrEmpty(link.textContent)) {
            labels.push(link.textContent);
        }
        let aria = link.getAttribute ? link.getAttribute("aria-label") : null;
        if (!util.isNullOrEmpty(aria)) {
            labels.push(aria);
        }
        let title = link.getAttribute ? link.getAttribute("title") : null;
        if (!util.isNullOrEmpty(title)) {
            labels.push(title);
        }
        return labels.join(" ").trim();
    }

    /**
     * Removes navigation-related sibling nodes around a chapter navigation link.
     *
     * @param {HTMLAnchorElement|null} link - The navigation link anchor.
     * @returns {void}
     */
    static removeNavigationCueSiblings(link) {
        if (!link || !link.parentNode) {
            return;
        }
        Parser.removeNavigationNodesInDirection(link.previousSibling, -1);
        Parser.removeNavigationNodesInDirection(link.nextSibling, 1);
    }

    /**
     * Removes navigation cue nodes while traversing in one direction from a link.
     *
     * @param {Node|null} node - The starting sibling node.
     * @param {number} direction - Negative for backward, positive for forward traversal.
     * @returns {void}
     */
    static removeNavigationNodesInDirection(node, direction) {
        while (node != null) {
            if (Parser.shouldRemoveNavigationSibling(node)) {
                let next = (direction < 0) ? node.previousSibling : node.nextSibling;
                node.remove();
                node = next;
                continue;
            }
            if (Parser.isWhitespaceNode(node) || Parser.isDividerNode(node)) {
                let next = (direction < 0) ? node.previousSibling : node.nextSibling;
                node.remove();
                node = next;
                continue;
            }
            break;
        }
    }

    /**
     * Determines whether a sibling node is a removable navigation cue.
     *
     * @param {Node|null} node - The node to inspect.
     * @returns {boolean} True when the node should be removed.
     */
    static shouldRemoveNavigationSibling(node) {
        if (node == null) {
            return false;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            return Parser.isNavigationCueText(node.textContent);
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.querySelector && node.querySelector("a")) {
                return false;
            }
            let text = node.textContent || "";
            if (Parser.isNavigationCueText(text)) {
                return true;
            }
            if (Parser.isDividerNode(node)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Checks whether a node is a divider-only text block.
     *
     * @param {Node|null} node - The node to inspect.
     * @returns {boolean} True when the node only contains divider characters.
     */
    static isDividerNode(node) {
        if (!node) {
            return false;
        }
        let text = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (text === "") {
            return false;
        }
        return Parser.NAVIGATION_DIVIDER_REGEX.test(text);
    }

    /**
     * Checks whether a node is a whitespace-only text node.
     *
     * @param {Node|null} node - The node to inspect.
     * @returns {boolean} True when the node is a whitespace text node.
     */
    static isWhitespaceNode(node) {
        return (node?.nodeType === Node.TEXT_NODE) && util.isStringWhiteSpace(node.textContent || "");
    }

    /**
     * Removes empty navigation containers that only hold cues or blank text.
     *
     * @param {Element|null} root - The root element to scan.
     * @returns {void}
     */
    static removeEmptyNavigationContainers(root) {
        if (!root) {
            return;
        }
        let candidates = root.querySelectorAll(Parser.NAVIGATION_CONTAINER_SELECTOR);
        let nodesToRemove = [];
        for (let element of candidates) {
            if (element === root) {
                continue;
            }
            if (element.querySelector("a")) {
                continue;
            }
            let text = element.textContent?.replace(/\s+/g, " ").trim() || "";
            if (text === "" || Parser.isNavigationCueText(text)) {
                nodesToRemove.push(element);
            }
        }
        util.removeElements(nodesToRemove);
    }

    /**
     * Detects text that looks like a navigation cue such as next, previous, or chapter arrows.
     *
     * @param {string|null|undefined} text - The text to inspect.
     * @returns {boolean} True when the text is likely navigation-only content.
     */
    static isNavigationCueText(text) {
        if (util.isNullOrEmpty(text)) {
            return false;
        }
        let normalized = text.replace(/\s+/g, " ").trim();
        if ((normalized.length === 0) || (normalized.length > Parser.NAVIGATION_TEXT_MAX_LENGTH)) {
            return false;
        }
        if (Parser.NAVIGATION_TEXT_REGEX.test(normalized)) {
            return true;
        }
        let sanitized = normalized
            .toLowerCase()
            .replace(/chapter|chap\.?|ch\.?|episode|ep\.?|part|page/gi, " ")
            .replace(/[«»‹›←→⇐⇒<>\-|\\/\u2013\u2014]/g, " ")
            .replace(/\s+/g, " ").trim();
        if (sanitized.length === 0) {
            return true;
        }
        let tokens = sanitized.split(" ").filter(t => t.length > 0);
        if (tokens.length === 0) {
            return true;
        }
        return tokens.every(token => Parser.NAVIGATION_KEYWORDS.includes(token));
    }

    /**
     * Tags the provided nodes as author notes so they can be styled or filtered later.
     *
     * @param {Array<Element>} elements - The elements to tag.
     * @returns {void}
     */
    tagAuthorNotes(elements) {
        for (let e of elements) {
            e.classList.add("webToEpub-author-note");
        }
    }

    /**
     * Tags or removes author notes selected by a CSS selector based on user preferences.
     *
     * @param {Element} element - The root element containing note candidates.
     * @param {string} selector - The CSS selector used to locate notes.
     * @returns {void}
     */
    tagAuthorNotesBySelector(element, selector) {
        let notes = element.querySelectorAll(selector);
        if (this.userPreferences.removeAuthorNotes.value) {
            util.removeElements(notes);
        } else {
            this.tagAuthorNotes(notes);
        }
    }

    /**
     * Creates an empty HTML document seeded with the WebToEpub content container.
     *
     * @param {string|null} baseUrl - Optional base URL to apply to the document.
     * @returns {{ dom: Document, content: HTMLElement }} The empty document and its content node.
     */
    static makeEmptyDocForContent(baseUrl) {
        let dom = document.implementation.createHTMLDocument("");
        if (baseUrl != null) {
            util.setBaseTag(baseUrl, dom);
        }
        let content = dom.createElement("div");
        content.className = Parser.WEB_TO_EPUB_CLASS_NAME;
        dom.body.appendChild(content);
        return {
            dom: dom,
            content: content
        };
    }

    /**
     * Locates the constructed content container within a generated document.
     *
     * @param {Document|Element} dom - The DOM to search.
     * @returns {HTMLElement|null} The content container, if present.
     */
    static findConstrutedContent(dom) {
        return dom.querySelector("div." + Parser.WEB_TO_EPUB_CLASS_NAME);
    }

    /**
     * Appends plain text as paragraph nodes into the chapter content.
     *
     * @param {{ dom: Document, content: HTMLElement }} newDoc - The generated document wrapper.
     * @param {string} contentText - The raw text to split into paragraphs.
     * @returns {void}
     */
    static addTextToChapterContent(newDoc, contentText) {
        let lines = contentText
            .replace(/\r/g, "\n")
            .replace(/\n\n/g, "\n")
            .split("\n")
            .filter(s => !util.isNullOrEmpty(s));
        for (let line of lines) {
            let pnode = newDoc.dom.createElement("p");
            pnode.textContent = line;
            newDoc.content.appendChild(pnode);
        }
    }

    /**
     * Loads chapter URLs from multiple TOC pages and combines the results.
     *
     * @param {Document} dom - The first TOC page DOM.
     * @param {Function} extractPartialChapterList - Extracts chapters from a TOC DOM.
     * @param {Function} getUrlsOfTocPages - Returns the additional TOC URLs.
     * @param {Object} chapterUrlsUI - The chapter URL UI helper.
     * @returns {Promise<Array<Object>>} The combined chapter list.
     */
    async getChapterUrlsFromMultipleTocPages(dom, extractPartialChapterList, getUrlsOfTocPages, chapterUrlsUI) {
        let chapters = extractPartialChapterList(dom);
        let urlsOfTocPages = getUrlsOfTocPages(dom);
        return await this.getChaptersFromAllTocPages(chapters, extractPartialChapterList, urlsOfTocPages, chapterUrlsUI);
    }

    /**
     * Returns the current per-chapter delay including any story-specific override.
     *
     * @returns {number} The delay in milliseconds.
     */
    getRateLimit() {
        let manualDelayPerChapterValue = (!isNaN(parseInt(this.userPreferences.manualDelayPerChapter.value, 10)))
            ? parseInt(this.userPreferences.manualDelayPerChapter.value, 10)
            : this.minimumThrottle;

        let configured = this.userPreferences.overrideMinimumDelay.value
            ? manualDelayPerChapterValue
            : Math.max(this.minimumThrottle, manualDelayPerChapterValue);

        let storyDelay = 0;
        if (this.state.chapterListUrl) {
            storyDelay = Parser.additionalDelayByStory.get(this.state.chapterListUrl) || 0;
        }

        return configured + storyDelay;
    }

    /**
     * Waits for the configured rate-limit delay before the next network request.
     *
     * @returns {Promise<void>} Resolves after the delay completes.
     */
    async rateLimitDelay() {
        let delay = this.getRateLimit();
        await util.sleep(delay);
    }

    /**
     * Increases the current story's delay after a 403 response when auto-tuning is enabled.
     *
     * @returns {void}
     */
    increaseDelayForCurrentStoryOn403() {
        if (!this.userPreferences || !this.state.chapterListUrl || !this.userPreferences.autoIncreaseDelayOn403.value) {
            return;
        }

        let increment = parseInt(this.userPreferences.autoIncreaseDelayOn403Amount.value, 10);
        if (isNaN(increment) || increment < 0) {
            increment = 1000;
        }

        let storyKey = this.state.chapterListUrl;
        let previous = Parser.additionalDelayByStory.get(storyKey) || 0;
        let updated = previous + increment;
        Parser.additionalDelayByStory.set(storyKey, updated);

        util.log(`[WebToEpub] Increased per-story delay for ${storyKey} by ${increment} ms (total ${updated} ms).`);
    }

    /**
     * Walks all TOC pages, fetching and concatenating chapter lists from each page.
     *
     * @param {Array<Object>} chapters - The current chapter list.
     * @param {Function} extractPartialChapterList - Extracts chapters from a TOC DOM.
     * @param {Array<string>} urlsOfTocPages - Additional TOC page URLs to fetch.
     * @param {Object} chapterUrlsUI - The chapter URL UI helper.
     * @param {Object} [wrapOptions] - Optional fetch wrapper options.
     * @returns {Promise<Array<Object>>} The combined chapter list.
     */
    async getChaptersFromAllTocPages(chapters, extractPartialChapterList, urlsOfTocPages, chapterUrlsUI, wrapOptions) {
        if (0 < chapters.length) {
            chapterUrlsUI.showTocProgress(chapters);
        }
        for (let url of urlsOfTocPages) {
            await this.rateLimitDelay();
            let newDom = (await HttpClient.wrapFetch(url, wrapOptions)).responseXML;
            let partialList = extractPartialChapterList(newDom);
            chapterUrlsUI.showTocProgress(partialList);
            chapters = chapters.concat(partialList);
        }
        return chapters;
    }

    /**
     * Walks linked TOC pages until no further page is available.
     *
     * @param {Document} dom - The initial TOC page DOM.
     * @param {Function} chaptersFromDom - Extracts chapters from a TOC DOM.
     * @param {Function} nextTocPageUrl - Returns the next TOC page URL.
     * @param {Object} chapterUrlsUI - The chapter URL UI helper.
     * @returns {Promise<Array<Object>>} The combined chapter list.
     */
    async walkTocPages(dom, chaptersFromDom, nextTocPageUrl, chapterUrlsUI) {
        let chapters = chaptersFromDom(dom);
        chapterUrlsUI.showTocProgress(chapters);
        let url = nextTocPageUrl(dom, chapters, chapters);
        while (url != null) {
            await this.rateLimitDelay();
            dom = (await HttpClient.wrapFetch(url)).responseXML;
            let partialList = chaptersFromDom(dom);
            chapterUrlsUI.showTocProgress(partialList);
            chapters = chapters.concat(partialList);
            url = nextTocPageUrl(dom, chapters, partialList);
        }
        return chapters;
    }

    /**
     * Moves collected footnotes into a dedicated section at the end of the chapter.
     *
     * @param {Document} dom - The chapter document.
     * @param {HTMLElement} content - The chapter content element.
     * @param {Array<HTMLElement>} footnotes - Footnote elements to move.
     * @returns {void}
     */
    moveFootnotes(dom, content, footnotes) {
        if (0 < footnotes.length) {
            let list = dom.createElement("ol");
            for (let f of footnotes) {
                let item = dom.createElement("li");
                f.removeAttribute("style");
                item.appendChild(f);
                list.appendChild(item);
            }
            let header = dom.createElement("h2");
            header.appendChild(dom.createTextNode("Footnotes"));
            content.appendChild(header);
            content.appendChild(list);
        }
    }

    /**
     * Follows paginated chapter content until no additional page is available.
     *
     * @param {string} url - The first chapter URL.
     * @param {Function} moreChapterTextUrl - Resolves the next page URL from the DOM.
     * @returns {Promise<Document>} The DOM containing the merged chapter content.
     */
    async walkPagesOfChapter(url, moreChapterTextUrl) {
        let dom = (await HttpClient.wrapFetch(url)).responseXML;
        let count = 2;
        let nextUrl = moreChapterTextUrl(dom, url, count);
        let oldContent = this.findContent(dom);
        while (nextUrl != null) {
            await this.rateLimitDelay();
            let nextDom = (await HttpClient.wrapFetch(nextUrl)).responseXML;
            let newContent = this.findContent(nextDom);
            nextUrl = moreChapterTextUrl(nextDom, url, ++count);
            oldContent.appendChild(dom.createElement("br"));
            util.moveChildElements(newContent, oldContent);
        }
        return dom;
    }
}

Parser.WEB_TO_EPUB_CLASS_NAME = "webToEpubContent";
Parser.LEADING_AGGREGATE_CHAPTER_REGEX = /^\s*(?<prefix>\d+)\s*[:;.-]?\s*(?<rest>.+)$/;
Parser.CHAPTER_NUMBER_REGEX = /\b(?:chapter|chap(?:ter)?|ch|episode|ep|part)\s*(?:[:.#-]?\s*)?(?:[ivxlcdm]+|\d+(?:\.\d+)?)|^\s*\d+\s*[:.#-]?\s*(?=\S)/i;
Parser.CHAPTER_NUMBER_MAX_OFFSET = 64;
Parser.COMMON_CHAPTER_NAME_REGEX = /^(prologue|epilogue|intro(?:duction)?|foreword|afterword|interlude|intermission|prelude|art\s*work|artwork|illustrations?|extras?|special|sidestory|side\s*story|omake|bonus)(\b|[^a-z])/i;
Parser.NAVIGATION_KEYWORDS = ["next", "previous", "prev", "first", "last"];
Parser.NAVIGATION_CONTAINER_SELECTOR = "p, div, span, strong, em, b, i, small, li, nav, header, footer";
Parser.NAVIGATION_DIVIDER_REGEX = /^[\s|\\/><«»‹›←→⇐⇒\-\u2013\u2014]+$/u;
Parser.NAVIGATION_TEXT_REGEX = /(?:\b(?:next|previous|prev|first|last)\b(?:\s+(?:chapter|chap\.?|episode|part))?|(?:chapter|chap\.?|episode|part)\s+\b(?:next|previous|first|last)\b|[«»‹›←→⇐⇒]{1,3})/i;
Parser.NAVIGATION_TEXT_MAX_LENGTH = 60;
Parser.additionalDelayByStory = new Map();
