/*
   parses Qidian International site
   also known as Webnovel.com
*/
"use strict";

parserFactory.register("webnovel.com", () => new QidianParser());

class QidianParagraphImageErrorHandler extends FetchErrorHandler {
    constructor(parser) {
        super();
        this.parser = parser;
    }

    onResponseError(url, wrapOptions, response, errorMessage) {
        if (response?.status === 429 || response?.status === 509) {
            this.parser?.noteParagraphImageRateLimit(response);
            if (wrapOptions.retry === undefined) {
                wrapOptions.retry = {
                    retryDelay: QidianParser.PARAGRAPH_IMAGE_RETRY_DELAYS.slice(),
                    promptUser: false,
                    HTTP: response.status
                };
                return this.retryFetch(url, wrapOptions);
            }

            if (0 < wrapOptions.retry.retryDelay.length) {
                return this.retryFetch(url, wrapOptions);
            }
            return Promise.reject(new Error(this.makeFailMessage(response.url, response.status)));
        }
        return super.onResponseError(url, wrapOptions, response, errorMessage);
    }
}

class QidianParser extends Parser {
    /**
     * Constructs a new parser instance, initializing throttle limits, cache for chapter titles,
     * logging state flags, and the download images preference based on the current UI checkbox.
     */
    constructor() {
        super();
        this.minimumThrottle = 50; // Minimal delay to reduce frequency of 445 errors.
        this.ChacheChapterTitle = new Map();
        this._csrfTokenLogged = false;
        this._cookiesLogged = false;
        this._permissionsLogged = false;
        this._cookieApiLogged = false;

        this.paragraphImageMinDelayMs = 1200;
        this.paragraphImageJitterMs = 300;
        this._nextParagraphImageAt = 0;
        this._paragraphImageRateLimitBackoffMs = 0;
        this._paragraphImageRateLimitResetAt = 0;
        this._chapterIndexByUrl = null;
        this._paragraphImageHintShown = false;

        this.downloadAndIncludeImages = document.getElementById("webnovelDownloadImagesCheckbox")?.checked ?? false;
    }

    /**
     * Retrieves the list of chapter links from a Qidian book or comic page, loading the catalog view if necessary.
     * Preserves volume/section groupings by marking the initial chapter of each volume with `newArc`.
     *
     * @param {Document} dom - The DOM of the current page; if not already on the catalog, it will fetch and parse the catalog page.
     * @returns {Promise<Array<{ sourceUrl: string, title: string, newArc: string|null, isIncludeable: boolean }>>} A promise that resolves to an array of chapter descriptors derived from the catalog links.
     */
    async getChapterUrls(dom) {
        if (!dom.baseURI.match(new RegExp("/catalog$"))) {
            let newURL = dom.baseURI;
            let regex = new RegExp("(/book/(?:.*?_)?\\d+\\b).*");
            newURL = newURL.replace(regex, "$1/catalog");
            regex = new RegExp("(/comic/(?:.*?_)?\\d+\\b).*");
            newURL = newURL.replace(regex, "$1/catalog");
            dom = (await HttpClient.wrapFetch(newURL)).responseXML;
        }
        let volumeItems = Array.from(dom.querySelectorAll("div.volume-item"));
        let chapters = [];
        if (0 < volumeItems.length) {
            for (let volumeItem of volumeItems) {
                let rawVolumeTitle = volumeItem.querySelector("h4, h3, .volume-title, .sub-tit")?.textContent || null;
                let volumeTitle = QidianParser.cleanVolumeTitle(rawVolumeTitle);
                let links = Array.from(volumeItem.querySelectorAll("ol a, ul a, li a, a"));
                let isFirstInVolume = true;
                for (let link of links) {
                    let newArc = (isFirstInVolume && volumeTitle) ? volumeTitle : null;
                    let chapter = QidianParser.linkToChapter(link, newArc);
                    chapters.push(chapter);
                    isFirstInVolume = false;
                }
            }
        }
        if (chapters.length === 0) {
            let links = Array.from(dom.querySelectorAll("ul.content-list a, ol.content-list a, ol a, ul a"));
            chapters = links.map(link => QidianParser.linkToChapter(link, null));
        }
        this.maybeNotifyParagraphImageHint(chapters);
        return chapters;
    }

    /**
     * Cleans and normalizes a volume or section title by collapsing redundant whitespace and standardizing separator spacing.
     *
     * @param {string|null|undefined} title - The raw volume title string.
     * @returns {string|null} The cleaned volume title, or null if empty.
     */
    static cleanVolumeTitle(title) {
        if (!title) {
            return null;
        }
        let cleaned = Parser.normalizeWhitespace(title);
        cleaned = cleaned.replace(/\s*:\s*/g, ": ");
        cleaned = cleaned.replace(/\s+/g, " ").trim();
        return (cleaned.length > 0) ? cleaned : null;
    }

    /**
     * Checks if a chapter link represents a locked or premium chapter.
     *
     * @param {HTMLAnchorElement} link - The chapter anchor element to inspect.
     * @returns {boolean} True if the link contains a locked icon, false otherwise.
     */
    static isLinkLocked(link) {
        let img = link.querySelector("svg > use");
        return (img != null)
            && (img.getAttribute("xlink:href") === "#i-lock");
    }

    /**
     * Extracts chapter metadata from a chapter link element.
     *
     * @param {HTMLAnchorElement} link - Anchor element representing the chapter link.
     * @param {string|null} [newArc=null] - Optional volume or section title to mark the start of an arc.
     * @returns {{ sourceUrl: string, title: string, newArc: string|null, isIncludeable: boolean }} An object containing the chapter URL, title, arc metadata, and a flag indicating if the chapter is accessible.
     */
    static linkToChapter(link, newArc = null) {
        let title = link.textContent;
        let element = link.querySelector("strong");
        if (element !== null) {
            title = element.textContent.trim();
            if (!document.getElementById("removeChapterNumberCheckbox")?.checked) {
                element = link.querySelector("i");
                if (element !== null) {
                    title = element.textContent + ": " + title;
                }
            }
        }
        return {
            sourceUrl: link.href,
            title: title,
            newArc: newArc ?? null,
            isIncludeable: !QidianParser.isLinkLocked(link)
        };
    }

    /**
     * Locates the chapter content container within the provided DOM.
     *
     * @param {Document|Element} dom - The DOM to search for the chapter content.
     * @returns {Element|null} The chapter content element if found, otherwise `null`.
     */
    findContent(dom) {
        return dom.querySelector("div.chapter_content");
    }

    /**
     * Preprocesses the raw DOM for a Qidian chapter, normalizing titles, extracting or constructing
     * chapter content, attaching images, and cleaning ancillary elements before further processing.
     *
     * @async
     * @override
     * @param {Document} webPage - The DOM document of the chapter page to preprocess.
     * @returns {Promise<void>} Resolves when preprocessing (including image attachments) is complete.
     */
    async preprocessRawDom(webPage) {
        if (this.ChacheChapterTitle.size == 0) {
            let pagesToFetch = [...this.state.webPages.values()].filter(c => c.isIncludeable);
            pagesToFetch.map(a => (this.ChacheChapterTitle.set(a.sourceUrl, this.normalizeChapterTitle(a.title))));
        }
        let content = this.findContent(webPage);
        if (content === null) {
            return;
        }

        // Clean and normalize the raw DOM content.
        content = this.cleanRawDom(content, webPage);

        // Attach paragraph images if the user preference is enabled.
        if (this.downloadAndIncludeImages) {
            console.log("[WebToEpub][QidianParser] Adding paragraph images.");

            // Log the content before starting to add paragraph images.
            console.log("[WebToEpub][QidianParser] Content before adding paragraph images:", content);
            await this.getAndAttachParagraphImages(webPage, content);
            // Log the content after paragraph images have been attached.
            console.log("[WebToEpub][QidianParser] Added paragraph images to content:", content);
        }

        // Build content from JSON if available.
        let json = this.findChapterContentJson(webPage);
        if (json === null) {
            return;
        }
        content = webPage.createElement("div");
        content.className = "chapter_content";
        webPage.body.appendChild(content);
        this.addHeader(webPage, content, this.normalizeChapterTitle(json.chapterInfo.chapterName));
        for (let c of json.chapterInfo?.contents?json.chapterInfo.contents:[]) {
            this.addParagraph(webPage, content, c.content);
        }
        for (let c of json.chapterInfo?.chapterPage?json.chapterInfo.chapterPage:[]) {
            this.addComicPage(webPage, content, c.url);
        }
        if (!this.userPreferences.removeAuthorNotes.value) {
            let notes = json.chapterInfo.notes?.note ?? null;
            if (!util.isNullOrEmpty(notes)) {
                let container = this.addNoteContainer(webPage, content);
                this.addHeader(webPage, container, "Notes");
                this.addParagraph(webPage, container, notes);
            }
        }
        for (let e of [...webPage.querySelectorAll("div.j_bottom_comment_area, div.user-links-wrap, div.g_ad_ph")]) {
            e.remove();
        }
    }

    /**
     * Cleans and normalizes a chapter DOM by removing unused metadata, ensuring a proper title header,
     * and eliminating duplicate leading chapter titles for web pages.
     *
     * @param {Document|Element} content - The DOM content of the chapter to clean and normalize.
     * @param {boolean} webPage - Whether the content originates from a webpage, triggering duplicate title removal.
     * @returns {Document|Element} The cleaned DOM with metadata removed and the chapter title normalized.
     */
    cleanRawDom(content, webPage) {
        // Remove repeating & unused metadata from document. Approximately halves body length.
        content.querySelectorAll("i.para-comment_num, i.para-comment").forEach(i => i.remove());
        let chapterContent = content.matches?.("div.chapter_content")
            ? content
            : content.querySelector("div.chapter_content") ?? content;
        let tmptitle = this.ChacheChapterTitle.get(content.baseURI);
        let newtitlenode = document.createElement("h1");
        let resolvedTitle = tmptitle;
        if (util.isNullOrEmpty(resolvedTitle) || (resolvedTitle == "[placeholder]")) {
            let titleEl = chapterContent.querySelector("h1");
            resolvedTitle = this.normalizeChapterTitle(titleEl?.textContent ?? "");
        }
        if (!util.isNullOrEmpty(resolvedTitle)) {
            newtitlenode.appendChild(document.createTextNode(resolvedTitle));
            let existingHeader = chapterContent.querySelector("h1");
            if (existingHeader) {
                existingHeader.replaceWith(newtitlenode);
            } else {
                chapterContent.insertBefore(newtitlenode, chapterContent.firstChild);
            }
        }
        if (webPage) {
            let normalizedTitle = this.normalizeChapterTitle(resolvedTitle);
            if (!util.isNullOrEmpty(normalizedTitle)) {
                this.removeDuplicateLeadingChapterTitles(content, normalizedTitle);
            }
        }
        return content;
    }

    /**
     * Extracts chapter content metadata from embedded script tags on the page.
     *
     * @param {Document} dom - The DOM tree to search for chapter information.
     * @returns {any} The parsed JSON payload describing the chapter content, or `undefined` if none is found.
     */
    findChapterContentJson(dom) {
        const searchString = "var chapInfo=";
        return [...dom.querySelectorAll("script")]
            .map(s => s.textContent)
            .filter(s => s.startsWith(searchString))
            .map(s => util.locateAndExtractJson(this.fixExcaping(s), searchString))[0];
    }

    /**
     * Removes backslashes and specific newline or paragraph tags from the provided string.
     *
     * @param {string} s - The input string potentially containing escaped characters and HTML tags.
     * @returns {string} The cleaned string with backslashes, newlines, carriage returns, and paragraph tags stripped out.
     */
    fixExcaping(s) {
        return this.stripBackslash(s)
            .replace(/\n|\r|<\/?p>/g, "");
    }

    /**
     * Inserts a header element into the provided content container.
     * @param {Document|HTMLElement} webPage - The current webpage context where the header will be added.
     * @param {HTMLElement} content - The parent element to which the header will be appended.
     * @param {string} text - The text content for the header element.
     */
    addHeader(webPage, content, text) {
        this.addElement(webPage, content, "h3", text);
    }

    /**
     * Adds a paragraph element to the specified web page content.
     *
     * @param {Object} webPage - The web page context where the paragraph will be inserted.
     * @param {HTMLElement|DocumentFragment} content - The parent content node to which the paragraph is added.
     * @param {string} text - The text content to place inside the paragraph element.
     */
    addParagraph(webPage, content, text) {
        this.addElement(webPage, content, "p", text);
    }

    /**
     * Adds a comic page image to the given content container.
     *
     * @param {Document} webPage - The document used to create the image element.
     * @param {HTMLElement} content - The container to which the comic page image will be appended.
     * @param {string} text - The source URL of the comic page image.
     * @returns {HTMLImageElement} The newly created and appended image element.
     */
    addComicPage(webPage, content, text) {
        let t = webPage.createElement("img");
        t.src = text;
        content.appendChild(t);
        return t;
    }

    /**
     * Adds a note container element to the provided content and tags it as an author note.
     *
     * @param {Object} webPage - The web page context where the note container is added.
     * @param {HTMLElement} content - The parent element in which to insert the note container.
     * @returns {HTMLElement} The newly created note container element.
     */
    addNoteContainer(webPage, content) {
        let container = this.addElement(webPage, content, "div", "");
        this.tagAuthorNotes([container]);
        return container;
    }

    /**
     * Creates a new element with the specified tag and text, appends it to the given content node, and returns the created element.
     *
     * @param {Document} webPage - The document object used to create new elements.
     * @param {HTMLElement} content - The parent node to which the new element will be appended.
     * @param {string} tag - The HTML tag name for the element to create.
     * @param {string} text - The text content to set on the created element.
     * @returns {HTMLElement} The newly created and appended element.
     */
    addElement(webPage, content, tag, text) {
        let t = webPage.createElement(tag);
        t.textContent = text;
        content.appendChild(t);
        return t;
    }

    /**
     * Removes backslash-escaped sequences from a string, converting simple escape sequences (e.g., \n, \t) to spaces
     * while preserving literal escape characters for quotes and backslashes.
     *
     * @param {string} s - The input string potentially containing backslash-escaped characters.
     * @returns {string} The processed string with specified escape sequences stripped or preserved as appropriate.
     */
    stripBackslash(s) {
        const singleEscapeChars = "\"\\";
        const stripChars = "bfnrtv";
        let temp = "";
        let i = 0;
        while (i < (s.length)) {
            if (s[i] === "\\") {
                ++i;
                if (stripChars.includes(s[i])) {
                    temp += " ";
                }
                else {
                    if (singleEscapeChars.includes(s[i])) {
                        temp += "\\";
                    }
                    temp += s[i];
                }
            }
            else {
                temp += s[i];
            }
            ++i;
        }
        return temp;
    }

    /**
     * Parses a paragraph's metadata JSON string, handling HTML-encoded quotes.
     *
     * @param {string} raw - The raw metadata string, potentially containing `&quot;` entities.
     * @returns {Object|null} The parsed metadata object on success, or `null` if the input is empty or parsing fails.
     */
    parseParagraphMeta(raw) {
        if (util.isNullOrEmpty(raw)) {
            return null;
        }
        try {
            return JSON.parse(raw.replace(/&quot;/g, "\"") ?? raw);
        } catch (err) {
            ErrorLog.log(err);
            return null;
        }
    }

    /**
     * Extracts a CSRF token from cookies or embedded scripts within the provided DOM.
     *
     * @private
     * @param {Document|Object} dom - The DOM-like object containing cookies and script elements to search.
     * @returns {string|null} The decoded CSRF token if found, otherwise `null`.
     */
    extractCsrfToken(dom) {
        let cookieSource = dom.cookie ?? document.cookie ?? "";
        this.logCookies(cookieSource);
        let cookieMatch = cookieSource.match(/_csrfToken=([^;]+)/i);
        if (cookieMatch) {
            return decodeURIComponent(cookieMatch[1]);
        }

        let scriptText = [...dom.querySelectorAll("script")]?.map(s => s.textContent).join("\n") ?? "";
        let scriptMatch = scriptText.match(/(?:_csrfToken|csrfToken)\s*[:=]\s*["']([^"']+)/i);
        return scriptMatch ? scriptMatch[1] : null;
    }

    /**
     * Retrieves a CSRF token for the provided page.
     *
     * Attempts to extract the token directly from the page; if absent, logs
     * cookie permission status and fetches the token via the cookies API.
     *
     * @async
     * @private
     * @param {Document|Location|Object} webPage - The page context used to extract or resolve the CSRF token (baseURI/URL/location).
     * @returns {Promise<string>} Resolves to the CSRF token, or an empty string if none can be determined.
     */
    async getCsrfToken(webPage) {
        let token = this.extractCsrfToken(webPage) ?? "";
        if (!util.isNullOrEmpty(token)) {
            return token;
        }
        await this.logCookiePermissionStatus();
        let apiToken = await this.getCsrfTokenFromCookiesApi(webPage?.baseURI ?? webPage?.URL ?? webPage?.location?.href);
        return apiToken ?? "";
    }

    /**
     * Logs the provided CSRF token to the console once per parser instance.
     *
     * @private
     * @param {string|null|undefined} token - The CSRF token to log; if absent, a placeholder is shown.
     * @returns {void}
     */
    logCsrfToken(token) {
        if (this._csrfTokenLogged) {
            return;
        }
        this._csrfTokenLogged = true;
        console.log("[WebToEpub][QidianParser] _csrfToken:", token ?? "<null>");
    }

    /**
     * Logs the current document cookies to the console once and prevents duplicate logging.
     *
     * @private
     * @param {string} [cookieSource] - Optional cookie string to log; logs "<empty>" if not provided.
     * @returns {void}
     */
    logCookies(cookieSource) {
        if (this._cookiesLogged) {
            return;
        }
        this._cookiesLogged = true;
        console.log("[WebToEpub][QidianParser] document.cookie:", cookieSource || "<empty>");
    }

    /**
     * Logs the cookies permission status for the Qidian parser once per instance,
     * using the browser or Chrome permissions API to report availability and current permissions.
     *
     * @private
     * @returns {Promise<void>} Resolves when the permission status has been checked and logged.
     */
    async logCookiePermissionStatus() {
        if (this._permissionsLogged) {
            return;
        }
        this._permissionsLogged = true;
        try {
            let permissions = {origins: ["*://webnovel.com/"], permissions: ["cookies"]};
            let result = (typeof browser !== "undefined" && browser.permissions?.contains)
                ? await browser.permissions.contains(permissions)
                : (typeof chrome !== "undefined" && chrome.permissions?.contains)
                    ? await new Promise(resolve => chrome.permissions.contains(permissions, resolve))
                    : "permissions API unavailable";
            console.log("[WebToEpub][QidianParser] cookies permission contains?", result);
            if (typeof browser !== "undefined" && browser.permissions?.getAll) {
                let all = await browser.permissions.getAll();
                console.log("[WebToEpub][QidianParser] permissions.getAll:", all);
            } else if (typeof chrome !== "undefined" && chrome.permissions?.getAll) {
                let all = await new Promise(resolve => chrome.permissions.getAll(resolve));
                console.log("[WebToEpub][QidianParser] permissions.getAll:", all);
            } else {
                console.log("[WebToEpub][QidianParser] permissions.getAll unavailable");
            }
        } catch (err) {
            console.log("[WebToEpub][QidianParser] cookies permission check failed", err);
        }
    }

    /**
     * Attempts to extract the `_csrfToken` value using the browser or Chrome cookies API for the given URL.
     *
     * @private
     * @param {string} url - The URL whose associated cookies should be inspected.
     * @returns {Promise<string|null>} Resolves with the CSRF token if found, otherwise `null`.
     */
    async getCsrfTokenFromCookiesApi(url) {
        if (!url) {
            return null;
        }
        try {
            let cookieApi = (typeof browser !== "undefined" && browser.cookies?.get) ? browser.cookies : null;
            if (!cookieApi && typeof chrome !== "undefined" && chrome.cookies?.get) {
                cookieApi = {
                    get: (details) => new Promise(resolve => chrome.cookies.get(details, resolve)),
                    getAll: (details) => new Promise(resolve => chrome.cookies.getAll(details, resolve))
                };
            }
            if (!cookieApi) {
                if (!this._cookieApiLogged) {
                    this._cookieApiLogged = true;
                    console.log("[WebToEpub][QidianParser] cookies API unavailable");
                }
                return null;
            }
            if (!this._cookieApiLogged) {
                this._cookieApiLogged = true;
                console.log("[WebToEpub][QidianParser] cookies API available");
            }
            let cookie = await cookieApi.get({url: url, name: "_csrfToken"});
            if (cookie?.value) {
                console.log("[WebToEpub][QidianParser] _csrfToken from cookies API:", cookie.value);
                return cookie.value;
            }
            let domain = new URL(url).hostname;
            let domainCookie = await cookieApi.getAll({domain: domain, name: "_csrfToken"});
            if (domainCookie && domainCookie.length > 0 && domainCookie[0].value) {
                console.log("[WebToEpub][QidianParser] _csrfToken from cookies API domain lookup:", domainCookie[0].value);
                return domainCookie[0].value;
            }
        } catch (err) {
            console.log("[WebToEpub][QidianParser] cookies API fetch failed", err);
        }
        return null;
    }

    /**
     * Builds the paragraph review URL for a given chapter and paragraph.
     *
     * @private
     * @param {string} [token] - CSRF token to include in the request; defaults to an empty string if not provided.
     * @param {string|number} chapterId - Identifier of the chapter containing the paragraph.
     * @param {string|number} paragraphId - Identifier of the paragraph for which reviews are requested.
     * @returns {string} The fully constructed URL pointing to the paragraph review list endpoint.
     */
    buildParagraphReviewUrl(token, chapterId, paragraphId) {
        const ts = Date.now().toString();
        let params = new URLSearchParams({
            _csrfToken: token ?? "",
            chapterId: chapterId,
            paragraphId: paragraphId,
            lastTime: "0",
            _: ts
        });
        return "https://www.webnovel.com/go/pcm/paragraphReview/getReiewList?" + params.toString(); // Note: "Reiew" is not a typo; that's how it is written in the original URL.
    }

    /**
     * Fetches image URLs associated with a specific paragraph of a chapter.
     *
     * @private
     * @param {string} token - Authorization token; when empty, no request is made and an empty array is returned.
     * @param {string|number} chapterId - Identifier of the chapter containing the paragraph.
     * @param {string|number} paragraphId - Identifier of the paragraph whose images are requested.
     * @returns {Promise<string[]>} Resolves to an array of image URLs; returns an empty array on missing token or fetch errors.
     */
    async fetchParagraphImages(token, chapterId, paragraphId) {
        if (util.isNullOrEmpty(token)) {
            return [];
        }
        let url = this.buildParagraphReviewUrl(token, chapterId, paragraphId);
        try {
            let response = await HttpClient.wrapFetchImpl(url, {
                responseHandler: new FetchJsonResponseHandler(),
                fetchOptions: {credentials: "include"},
                errorHandler: new QidianParagraphImageErrorHandler(this)
            });
            let items = response?.json?.data?.paragraphTopicItems ?? [];
            let images = [];
            for (let item of items) {
                for (let image of (item.imageItems ?? [])) {
                    if (!util.isNullOrEmpty(image.imageUrl)) {
                        // console.log("[WebToEpub][QidianParser] Fetched paragraph image URL:", image.imageUrl);
                        images.push(image.imageUrl);
                    }
                }
            }
            return images;
        } catch (err) {
            ErrorLog.log(err);
            return [];
        }
    }

    /**
     * Appends a set of paragraph images into a target container within the provided web page.
     *
     * @private
     * @param {Element} container - The paragraph element where images should be inserted.
     * @param {string[]} urls - An array of image URLs to append.
     * @param {Document} webPage - The document object used to create elements.
     * @returns {void}
     */
    appendParagraphImages(container, urls, webPage) {
        // Logging the number of images to be appended.
        console.log("[WebToEpub][QidianParser] Appending", urls.length, "paragraph images.");
        if (!urls || urls.length === 0) {
            return;
        }
        let target = container.matches(".dib.pr")
            ? container
            : container.querySelector(".dib.pr") || container;

        // Logging the target paragraph element for image insertion.
        let targetParagraphs = target.getElementsByTagName("p")?.[0] || false;
        console.log("[WebToEpub][QidianParser] Found target paragraph for images:", targetParagraphs ? targetParagraphs.outerHTML : "<none>");

        // Logging the target element where images will be appended.
        console.log("[WebToEpub][QidianParser] Appending images to target element:", target);

        // Use an inline wrapper so sanitization keeps the image nodes
        // even when appended inside paragraph tags.
        let wrapper = webPage.createElement("div");
        wrapper.className = "webtoepub-paragraph-images";
        // Set display to block to ensure proper rendering.
        wrapper.style.display = "block";

        for (let url of urls) {
            let img = webPage.createElement("img");
            img.src = url;
            // wrapper.appendChild(img);

            let a = webPage.createElement("a");
            a.href = url;
            a.appendChild(img);
            wrapper.appendChild(a);
        }
        // Logging the number of images appended to the wrapper.
        console.log("[WebToEpub][QidianParser] Appended", wrapper.childElementCount, "images to wrapper.", "Wrapper HTML:", wrapper.outerHTML);
        target.appendChild(wrapper);
        // Log the paragraph with the inserted images.
        console.log("[WebToEpub][QidianParser] Appended images to paragraph:", target.outerHTML);
    }

    /**
     * Fetches and appends inline images for eligible paragraphs within the given content.
     *
     * The method:
     *  - Filters paragraphs flagged with `data-ejs` that meet image-fetch criteria.
     *  - Verifies user preference for downloading paragraph images.
     *  - Ensures a valid CSRF token exists before issuing requests.
     *  - Retrieves images for each paragraph and appends them to the DOM when available.
     *
     * @async
     * @private
     * @param {Document|ParentNode} webPage - The full web page context, used to resolve tokens and perform fetches.
     * @param {ParentNode} content - The container whose paragraphs will be scanned and potentially augmented with images.
     * @returns {Promise<void>} Resolves when all eligible paragraph image fetches and insertions complete, or exits early when prerequisites fail.
     */
    async getAndAttachParagraphImages(webPage, content) {
        let paragraphs = [...content.querySelectorAll(".j_paragraph[data-ejs]")]
            .filter(p => this.shouldFetchImagesFromParagraph(p));
        if (paragraphs.length === 0) {
            return;
        }
        if (!this.userPreferences?.webnovelDownloadParagraphImages?.value) {
            return;
        }
        this.ensureChapterIndexMap();
        let chapterIndex = this.getChapterIndexForUrl(webPage?.baseURI ?? "");
        let maxChapters = this.getNumericPreference("webnovelParagraphImagesMaxChapters", QidianParser.DEFAULT_MAX_CHAPTERS);
        if (maxChapters > 0 && chapterIndex !== null && chapterIndex > maxChapters) {
            return;
        }
        let maxPerChapter = this.getNumericPreference("webnovelParagraphImagesMaxPerChapter", QidianParser.DEFAULT_MAX_PER_CHAPTER);
        if (maxPerChapter > 0 && paragraphs.length > maxPerChapter) {
            paragraphs = paragraphs.slice(0, maxPerChapter);
        }
        let maxMisses = this.getNumericPreference("webnovelParagraphImagesMaxMisses", QidianParser.DEFAULT_MAX_MISSES);
        let consecutiveMisses = 0;
        await this.logCookiePermissionStatus();
        let token = await this.getCsrfToken(webPage);
        this.logCsrfToken(token);
        let hasToken = !util.isNullOrEmpty(token);
        if (!hasToken) {
            console.log("[WebToEpub][QidianParser] No _csrfToken found; skipping paragraph image requests.");
            return;
        }
        for (let paragraph of paragraphs) {
            await this.waitForParagraphImageSlot();
            let meta = this.parseParagraphMeta(paragraph.getAttribute("data-ejs"));
            if (!meta?.paragraphId || !meta?.chapterId) {
                continue;
            }
            let images = await this.fetchParagraphImages(token, meta.chapterId, meta.paragraphId);
            // Logging the number of images fetched for this paragraph.
            console.log("[WebToEpub][QidianParser] Fetched", images.length, "image(s) for paragraph ID", meta.paragraphId, "for chapter ID", meta.chapterId, "with text content:", paragraph.textContent);
            if (images.length === 0) {
                consecutiveMisses += 1;
                if (maxMisses > 0 && consecutiveMisses >= maxMisses) {
                    break;
                }
                continue;
            }
            consecutiveMisses = 0;
            this.appendParagraphImages(paragraph, images, webPage);
        }
        console.log("[WebToEpub][QidianParser] Attached images to paragraphs:", paragraphs.map(p => p.outerHTML).join("\n"));
    }

    /**
     * Determines whether images should be fetched from the given paragraph.
     *
     * @private
     * @param {Element|string} paragraph - The paragraph node or text to inspect.
     * @returns {boolean} True if the paragraph meets the criteria for image fetching; otherwise, false.
     */
    shouldFetchImagesFromParagraph(paragraph) {
        return this.isShortParagraphForImages(paragraph);
    }

    /**
     * Determines if the provided paragraph element should be treated as a short paragraph for images.
     * A paragraph is considered short if its normalized text content is empty, or if it contains
     * no more than 100 characters and only a single child `<p>` element.
     *
     * @private
     * @param {Element | null} paragraph - The paragraph DOM node to evaluate.
     * @returns {boolean} `true` if the paragraph qualifies as a short paragraph for images; otherwise `false`.
     */
    isShortParagraphForImages(paragraph) {
        if (!paragraph) {
            return false;
        }
        let text = (paragraph.textContent || "").replace(/\s+/g, " ").trim();
        let pCount = paragraph.querySelectorAll("p").length;
        if (text.length === 0) {
            return true;
        }
        return (text.length <= 100) && (pCount == 1);
    }

    noteParagraphImageRateLimit(response) {
        let now = Date.now();
        this._paragraphImageRateLimitBackoffMs = Math.max(this._paragraphImageRateLimitBackoffMs, 5000);
        this._paragraphImageRateLimitResetAt = Math.max(this._paragraphImageRateLimitResetAt, now + 5 * 60 * 1000);
        console.log("[WebToEpub][QidianParser] Paragraph image rate limit detected (HTTP", response?.status, "). Increasing delay between image requests.");
    }

    async waitForParagraphImageSlot() {
        let now = Date.now();
        if (this._paragraphImageRateLimitResetAt && now >= this._paragraphImageRateLimitResetAt) {
            this._paragraphImageRateLimitBackoffMs = 0;
            this._paragraphImageRateLimitResetAt = 0;
        }
        let delayMs = this.paragraphImageMinDelayMs;
        if (this._paragraphImageRateLimitBackoffMs) {
            delayMs = Math.max(delayMs, this._paragraphImageRateLimitBackoffMs);
        }
        let jitter = Math.floor(Math.random() * this.paragraphImageJitterMs);
        let waitMs = Math.max(0, this._nextParagraphImageAt - now);
        if (waitMs > 0) {
            await util.sleep(waitMs);
        }
        this._nextParagraphImageAt = Date.now() + delayMs + jitter;
    }

    /**
     * Populates the parser-specific UI controls for Qidian downloads,
     * ensuring author notes removal, chapter number removal, and image
     * download options are visible to the user.
     *
     * @returns {void}
     */
    populateUIImpl() {
        document.getElementById("removeAuthorNotesRow").hidden = false;
        document.getElementById("removeChapterNumberRow").hidden = false;
        document.getElementById("webnovelDownloadImagesRow").hidden = false;
        document.getElementById("webnovelParagraphImagesOptionsRow").hidden = false;

        this.syncWebnovelParagraphImageOptionState();
        let toggle = document.getElementById("webnovelDownloadImagesCheckbox");
        if (toggle) {
            toggle.addEventListener("change", () => this.onWebnovelDownloadImagesToggle());
        }
    }

    /**
     * Extracts the chapter title element from the given DOM structure.
     *
     * @param {Document|HTMLElement} dom - The DOM containing the chapter content.
     * @returns {Element|null} The chapter title element if found, otherwise null.
     */
    extractTitleImpl(dom) {
        let title = dom.querySelector("div.chapter_content h1");
        return title;
    }

    /**
     * Extracts the author name from the provided DOM by locating an anchor with the class `c_primary`.
     * Falls back to the parent parser's `extractAuthor` implementation if none is found.
     *
     * @param {Document|Element} dom - The DOM to search for the author element.
     * @returns {string|undefined} The extracted author name, or the result of the superclass method.
     */
    extractAuthor(dom) {
        return dom.querySelector("a.c_primary")?.textContent ?? super.extractAuthor(dom);
    }

    /**
     * Cleans the provided content element by removing unwanted child elements, tagging author notes, and performing superclass cleanup.
     *
     * @param {Element} content - The chapter content container element to sanitize.
     */
    removeUnwantedElementsFromContentElement(content) {
        util.removeChildElementsMatchingSelector(content, "form.cha-score, div.cha-bts, pirate, div.cha-content div.user-links-wrap, div.tac");
        this.tagAuthorNotesBySelector(content, "div.m-thou");
        super.removeUnwantedElementsFromContentElement(content);
    }

    /**
     * Retrieves the cover image URL from the provided DOM by checking for thumbnail images
     * within the `div.det-hd i.g_thumb img` selector, falling back to the first image
     * in the `div.det-hd` container if none are found.
     *
     * @param {Document|Element} dom - The DOM element or document to search for the cover image.
     * @returns {string|undefined} The URL of the cover image if found, otherwise `undefined`.
     */
    findCoverImageUrl(dom) {
        let imgs = [...dom.querySelectorAll("div.det-hd i.g_thumb img")];
        return 0 === imgs.length
            ? util.getFirstImgSrc(dom, "div.det-hd")
            : imgs.pop().src;
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("div._mn, div.det-abt")];
    }

    cleanInformationNode(node) {
        // Remove unwanted elements from the information node.
        // Make sure SVGs are removed before EPUB conversion to avoid layout issues.
        util.removeChildElementsMatchingSelector(node, "div._ft, span.g_star, svg");
        let detailRow = node.querySelector("div.mb12.fw700.lh24.det-hd-detail.c_000.fs0");
        if (detailRow) {
            for (let child of detailRow.children) {
                if (child.style) {
                    child.style.display = "block";
                }
            }
        }
    }

    extractSubject(dom) {
        let tags = ([...dom.querySelectorAll("div.m-tags a")]);
        return tags.map(e => e.textContent.replace(" # ", "").trim()).join(", ");
    }

    extractDescription(dom) {
        return dom.querySelector("div.det-abt p.c_000").textContent.trim();
    }

    maybeNotifyParagraphImageHint(chapters) {
        if (this._paragraphImageHintShown) {
            return;
        }
        if (this.userPreferences?.webnovelDownloadParagraphImages?.value) {
            return;
        }
        let hasHint = chapters?.some(chapter => QidianParser.isParagraphImageHintTitle(chapter?.title)) ?? false;
        if (!hasHint) {
            return;
        }
        this._paragraphImageHintShown = true;
        FetchErrorHandler.showTransientRateLimitWarning(UIText.Warning.warningWebnovelParagraphImagesHint, 8000);
    }

    static isParagraphImageHintTitle(title) {
        if (util.isNullOrEmpty(title)) {
            return false;
        }
        return QidianParser.PARAGRAPH_IMAGE_HINT_REGEX.test(title);
    }

    syncWebnovelParagraphImageOptionState() {
        let enabled = document.getElementById("webnovelDownloadImagesCheckbox")?.checked ?? false;
        let optionsRow = document.getElementById("webnovelParagraphImagesOptionsRow");
        if (optionsRow) {
            optionsRow.classList.toggle("webnovelOptionsDisabled", !enabled);
        }
        let controls = [
            "webnovelParagraphImagesMaxChaptersInput",
            "webnovelParagraphImagesMaxMissesInput",
            "webnovelParagraphImagesMaxPerChapterInput"
        ];
        for (let id of controls) {
            let input = document.getElementById(id);
            if (input) {
                input.disabled = !enabled;
            }
        }
    }

    onWebnovelDownloadImagesToggle() {
        this.syncWebnovelParagraphImageOptionState();
        let enabled = document.getElementById("webnovelDownloadImagesCheckbox")?.checked ?? false;
        if (enabled) {
            this.maybeShowWebnovelWarning();
            return;
        }
        this.dismissWebnovelWarningToast();
    }

    dismissWebnovelWarningToast() {
        let container = document.getElementById("rateLimitToastContainer");
        if (!container) {
            return;
        }
        let warningText = UIText.Warning.warningWebnovelParagraphImagesRateLimit;
        for (let toast of [...container.children]) {
            if (toast.textContent?.includes(warningText)) {
                toast.remove();
            }
        }
        if (container.childElementCount === 0) {
            container.remove();
        }
    }

    maybeShowWebnovelWarning() {
        // Check if user has permanently dismissed this warning
        const PREF_KEY = "webnovelParagraphImagesRateLimitWarningDismissed";
        const isDismissed = window.localStorage.getItem(PREF_KEY) === "true";
        if (isDismissed) {
            return; // User has dismissed; don't show warning
        }

        // Show warning every time with option to dismiss
        FetchErrorHandler.showTransientRateLimitWarningWithDismiss(
            UIText.Warning.warningWebnovelParagraphImagesRateLimit,
            8000,
            PREF_KEY
        );
    }

    ensureChapterIndexMap() {
        if (this._chapterIndexByUrl) {
            return;
        }
        this._chapterIndexByUrl = new Map();
        let index = 1;
        for (let page of this.state.webPages.values()) {
            if (!page.isIncludeable) {
                continue;
            }
            this._chapterIndexByUrl.set(util.normalizeUrlForCompare(page.sourceUrl), index);
            index += 1;
        }
    }

    getChapterIndexForUrl(url) {
        if (util.isNullOrEmpty(url) || !this._chapterIndexByUrl) {
            return null;
        }
        let normalized = util.normalizeUrlForCompare(url);
        return this._chapterIndexByUrl.get(normalized) ?? null;
    }

    getNumericPreference(prefName, fallback) {
        let prefValue = this.userPreferences?.[prefName]?.value ?? "";
        let parsed = Number.parseInt(prefValue, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return fallback;
        }
        return parsed;
    }
}

QidianParser.PARAGRAPH_IMAGE_RETRY_DELAYS = [300, 240, 180, 120, 60];
QidianParser.DEFAULT_MAX_CHAPTERS = 5;
QidianParser.DEFAULT_MAX_MISSES = 5;
QidianParser.DEFAULT_MAX_PER_CHAPTER = 25;
QidianParser.PARAGRAPH_IMAGE_HINT_REGEX = /\b(images?|characters?|character\s*lists?)\b/i;
