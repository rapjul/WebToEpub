/*
    General dumping ground for misc functions that I can't find a better place for.
    Warning: Don't look at this too closely, or you may lose your sanity.
    Side Note: Putting these all in one place may not have been a good idea.
    I think they're breeding. There seem to be more functions in here that I didn't create.
*/

"use strict";

/**
 * Utility module encapsulating helpers for DOM manipulation, sanitization, URL handling,
 * whitespace and style normalization, file naming, MIME detection, HTML/XHTML document creation,
 * and browser/runtime helpers for the WebToEpub extension.
 */
const util = (function() {
    var sleepController = new AbortController;

    /**
     * Pauses execution for a specified duration or until an abort signal is triggered.
     *
     * @param {number} ms - The number of milliseconds to wait before resolving.
     * @returns {Promise<void>} A promise that resolves when the delay elapses or the abort signal fires.
     */
    function sleep(ms) {
        return new Promise(resolve => {
            function finished() {
                resolve();
                sleepController.signal.removeEventListener("abort", finished);
            }
            sleepController.signal.addEventListener("abort", finished);
            setTimeout(finished, ms);
        });
    }

    function randomInteger(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * Determines whether the current runtime environment is Firefox.
     *
     * @returns {boolean} `true` if the `browser` global is defined (typically in Firefox), otherwise `false`.
     */
    function isFirefox() {
        if (navigator.brave && navigator.brave.isBrave)
        {
            return false;
        }
        else if (typeof (browser) === "undefined")
        {
            // old version of chrome
            return false;
        }
        else
        {
            // this only works as long as firefox hasn't implemented this 
            // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/PlatformNaclArch
            return (typeof (browser.runtime.PlatformNaclArch) == "undefined");
        }
    }

    /**
     * Retrieves the extension's version string from the runtime manifest.
     * Falls back to "unknown" when the runtime is unavailable (e.g., during unit tests).
     *
     * @returns {string} The extension version or "unknown" if the runtime is undefined.
     */
    function extensionVersion() {
        let runtime = isFirefox() ? browser.runtime : chrome.runtime;
        // when running unit tests, runtime is not available
        return (typeof (runtime) === "undefined") ? "unknown" : runtime.getManifest().version;
    }

    /**
     * Creates a new empty XHTML document with the proper doctype, html/head/body elements,
     * and a populated head section.
     *
     * @returns {Document} A newly initialized XHTML document ready for content insertion.
     */
    function createEmptyXhtmlDoc() {
        let doc = document.implementation.createDocument(XMLNS, "", null);
        addXhtmlDocTypeToStart(doc);
        let htmlNode = doc.createElementNS(XMLNS, "html");
        doc.appendChild(htmlNode);
        let head = doc.createElementNS(XMLNS, "head");
        htmlNode.appendChild(head);
        head.appendChild(doc.createElementNS(XMLNS, "title"));
        populateHead(doc, head);
        let body = doc.createElementNS(XMLNS, "body");
        htmlNode.appendChild(body);
        return doc;
    }

    /**
     * Appends a stylesheet link element to the provided document head.
     *
     * @param {Document} doc - The document to create the link element within.
     * @param {HTMLElement} head - The head element to which the stylesheet link will be appended.
     */
    function populateHead(doc, head) {
        let style = doc.createElementNS(XMLNS, "link");
        head.appendChild(style);
        style.setAttribute("href", makeRelative(styleSheetFileName()));
        style.setAttribute("type", "text/css");
        style.setAttribute("rel", "stylesheet");
    }

    /**
     * Creates a new empty HTML document, initializes its head section, and returns the Document instance.
     *
     * @returns {Document} A newly created HTML document with its head populated.
     */
    function createEmptyHtmlDoc() {
        let doc = document.implementation.createHTMLDocument("");
        populateHead(doc, doc.querySelector("head"));
        return doc;
    }

    /**
     * Creates a div element containing an SVG image wrapper for the specified source.
     *
     * Builds an XHTML document fragment with a wrapping div, an SVG element configured
     * with sizing and viewBox attributes, and an embedded image whose `xlink:href` is
     * set to the provided `href` (made relative). Optionally includes the original
     * image source URL either as a `<desc>` element or as an XML comment.
     *
     * @param {string} href - The image source URL to embed; will be converted to a relative path.
     * @param {number|string} width - The intrinsic width of the image, applied to the SVG image element and viewBox.
     * @param {number|string} height - The intrinsic height of the image, applied to the SVG image element and viewBox.
     * @param {string} origin - The original source URL; data URIs are cleared before use in metadata/comment.
     * @param {boolean} includeImageSourceUrl - When true, inserts the origin URL as a `<desc>`; otherwise adds it as a comment.
     * @returns {HTMLDivElement} A div element containing the configured SVG with the embedded image.
     */
    function createSvgImageElement(href, width, height, origin, includeImageSourceUrl) {
        let svg_ns = "http://www.w3.org/2000/svg";
        let xlink_ns = "http://www.w3.org/1999/xlink";
        let doc = createEmptyXhtmlDoc();
        let body = doc.getElementsByTagName("body")[0];
        let div = doc.createElementNS(XMLNS, "div");
        div.className = "svg_outer svg_inner";
        body.appendChild(div);
        const svg = document.createElementNS(svg_ns, "svg");
        svg.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:xlink", xlink_ns);
        div.appendChild(svg);
        svg.setAttributeNS(null, "height", "99%");
        svg.setAttributeNS(null, "width", "100%");
        svg.setAttributeNS(null, "version", "1.1");
        svg.setAttributeNS(null, "preserveAspectRatio", "xMidYMid meet");
        svg.setAttributeNS(null, "viewBox", "0 0 " + width + " " + height);
        let newImage = doc.createElementNS(svg_ns, "image");
        svg.appendChild(newImage);
        newImage.setAttributeNS(xlink_ns, "xlink:href", makeRelative(href));
        newImage.setAttributeNS(null, "width", width);
        newImage.setAttributeNS(null, "height", height);
        origin = clearIfDataUri(origin);
        if (includeImageSourceUrl) {
            let desc = doc.createElementNS(svg_ns, "desc");
            svg.appendChild(desc);
            desc.appendChild(document.createTextNode(origin));
        } else {
            svg.appendChild(createComment(doc, origin));
        }
        return div;
    }

    function clearIfDataUri(content) {
        // Filter out data: URIs to prevent massive base64 content
        return (content && content.startsWith("data:")) ? "" : content;
    }

    // assumes we're making link from file in OEBPS\Text to OEBPS\Images
    function makeRelative(href) {
        return ".." + href.substring(5);
    }

    function resolveRelativeUrl(baseUrl, relativeUrl) {
        return new URL(relativeUrl, baseUrl).href;
    }

    function extractHostName(url) {
        return new URL(url).hostname;
    }

    function extractFilename(hyperlink) {
        let filename = hyperlink.pathname
            .split("/")
            .filter(p => p !== "")
            .pop();
        return filename ?? "";
    }

    function extractFilenameFromUrl(url) {
        return new URL(url).pathname
            .split("/")
            .filter(p => p !== "")
            .pop();
    }

    function getParamFromUrl(url, paramName) {
        return new URL(url).searchParams.get(paramName);
    }

    // set the base tag of a DOM to specified URL.
    function setBaseTag(url, dom) {
        if (dom != null) {
            let tags = Array.from(dom.getElementsByTagName("base"));
            if (0 < tags.length) {
                tags[0].setAttribute("href", url);
            } else {
                let baseTag = dom.createElement("base");
                baseTag.setAttribute("href", url);
                dom.getElementsByTagName("head")[0].appendChild(baseTag);
            }
        }
    }

    // refer https://usamaejaz.com/cloudflare-email-decoding/
    function decodeCloudflareProtectedEmails(content) {
        for (let link of [...content.querySelectorAll(".__cf_email__")]) {
            replaceCloudflareProtectedLink(link);
        }
        let links = [...content.querySelectorAll("a")].filter(l => (l.href != null) && l.href.includes("/cdn-cgi/l/email-protection"));
        for (let link of links) {
            replaceCloudflareProtectedLink(link);
        }
    }

    function replaceCloudflareProtectedLink(link) {
        let cyptedEmail = link.getAttribute("data-cfemail");
        if (cyptedEmail == null) {
            cyptedEmail = link.hash;
            if (!isNullOrEmpty(cyptedEmail)) {
                cyptedEmail = cyptedEmail.substring(1);
            }
        }
        if (cyptedEmail != null) {
            let decryptedEmail = decodeEmail(cyptedEmail);
            let textNode = document.createTextNode(decryptedEmail);
            link.parentNode.insertBefore(textNode, link);
            link.remove();
        }
    }

    function decodeEmail(encodedString) {
        let extractHex = (index) => parseInt(encodedString.slice(index, index + 2), 16);
        let key = extractHex(0);
        let email = "";
        for (let index = 2; index < encodedString.length; index += 2) {
            email += String.fromCharCode(extractHex(index) ^ key);
        }
        return email;
    }

    /**
     * Removes all provided DOM elements from the document.
     *
     * @param {Iterable<Element>} elements - Collection of DOM elements to remove.
     */
    function removeElements(elements) {
        for (let e of elements) {
            e.remove();
        }
    }

    function removeChildElementsMatchingSelector(element, selector) {
        if (element !== null) {
            removeElements(element.querySelectorAll(selector));
        }
    }

    function removeComments(root) {
        let walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);

        // if we delete currentNode, call to nextNode() fails.
        let nodeList = [];
        while (walker.nextNode()) {
            nodeList.push(walker.currentNode);
        }
        removeElements(nodeList);
    }

    // discard empty divs created when moving elements
    /**
     * Removes all child `<div>` elements of the provided element that contain only whitespace.
     *
     * @param {Element} element - The root element whose descendant divs should be scanned and removed if empty.
     */
    function removeEmptyDivElements(element) {
        removeElements(getElements(element, "div", e => isElementWhiteSpace(e)));
    }

    /**
     * Removes whitespace-only text nodes from the end of an element’s child node list.
     *
     * @param {Node} element - The DOM element whose trailing whitespace child nodes should be removed.
     */
    function removeTrailingWhiteSpace(element) {
        let children = element.childNodes;
        while ((0 < children.length) && isElementWhiteSpace(children[children.length - 1])) {
            children[children.length - 1].remove();
        }
    }

    /**
     * Removes leading whitespace-only child nodes from the specified DOM element.
     *
     * @param {Node} element - The DOM node whose leading whitespace child nodes will be removed.
     */
    function removeLeadingWhiteSpace(element) {
        let children = element.childNodes;
        while ((0 < children.length) && isElementWhiteSpace(children[0])) {
            children[0].remove();
        }
    }

    /**
     * Recursively trims whitespace from the text nodes at the boundaries of the given element
     * and all of its descendant elements, skipping any elements where whitespace trimming
     * is not applicable.
     *
     * @param {Element} element - The DOM element whose text content boundaries should be trimmed.
     */
    function trimTextContent(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || shouldSkipWhitespaceTrim(element)) {
            return;
        }
        trimElementBoundaries(element);
        for (let child = element.firstElementChild; child != null; child = child.nextElementSibling) {
            trimTextContent(child);
        }
    }

    /**
     * Trims leading and trailing whitespace from the text boundaries of the given element,
     * skipping elements that should not have whitespace trimmed.
     *
     * @param {Element|null} element - The DOM element whose boundary whitespace should be trimmed.
     * @returns {void}
     */
    function trimElementBoundaries(element) {
        if (!element || shouldSkipWhitespaceTrim(element)) {
            return;
        }
        trimBoundaryWhitespace(element, true);
        trimBoundaryWhitespace(element, false);
    }

    /**
     * Trims leading or trailing whitespace-only nodes and whitespace characters from an element's boundary.
     *
     * Iterates from either the first or last child (based on `fromStart`), removing whitespace text nodes
     * and elements considered whitespace, and trimming boundary text nodes when necessary.
     *
     * @param {Node} element - The DOM element whose boundary whitespace should be trimmed.
     * @param {boolean} fromStart - If true, trims from the start (first child); otherwise trims from the end.
     */
    function trimBoundaryWhitespace(element, fromStart) {
        let child = fromStart ? element.firstChild : element.lastChild;
        while (child != null) {
            if (child.nodeType === Node.TEXT_NODE) {
                if (isStringWhiteSpace(child.textContent)) {
                    let next = fromStart ? child.nextSibling : child.previousSibling;
                    child.remove();
                    child = next;
                    continue;
                }

                let trimmed = child.textContent.trim();
                if (trimmed.length === 0) {
                    let next = fromStart ? child.nextSibling : child.previousSibling;
                    child.remove();
                    child = next;
                    continue;
                }

                if (trimmed !== child.textContent) {
                    let startIndex = child.textContent.indexOf(trimmed);
                    if (startIndex === -1) {
                        startIndex = 0;
                    }
                    if (fromStart && 0 < startIndex) {
                        child.textContent = child.textContent.substring(startIndex);
                    } else if (!fromStart) {
                        let endIndex = startIndex + trimmed.length;
                        if (endIndex < child.textContent.length) {
                            child.textContent = child.textContent.substring(0, endIndex);
                        }
                    }
                }
                break;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                if (isElementWhiteSpace(child)) {
                    let next = fromStart ? child.nextSibling : child.previousSibling;
                    child.remove();
                    child = next;
                    continue;
                }
                break;
            } else {
                let next = fromStart ? child.nextSibling : child.previousSibling;
                child.remove();
                child = next;
            }
        }
    }

    /**
     * Determines whether whitespace trimming should be skipped for a given DOM element.
     *
     * Skipping occurs when the node is an element whose tag is either `<pre>` or `<code>`.
     *
     * @param {Node} element - The DOM node to evaluate.
     * @returns {boolean} True if the element is a PRE or CODE element; otherwise, false.
     */
    function shouldSkipWhitespaceTrim(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }
        let tag = element.tagName.toLowerCase();
        return (tag === "pre") || (tag === "code");
    }

    /**
     * Recursively normalizes paragraph spacing within an element so that only a single
     * newline separates paragraphs, skipping elements that shouldn't be trimmed.
     *
     * @param {Element} element - The root DOM element to process; ignored if null, non-element, or marked to skip whitespace trimming.
     */
    function ensureSingleNewlineBetweenParagraphs(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || shouldSkipWhitespaceTrim(element)) {
            return;
        }
        normalizeParagraphSpacing(element);
        for (let child = element.firstElementChild; child != null; child = child.nextElementSibling) {
            ensureSingleNewlineBetweenParagraphs(child);
        }
    }

    /**
     * Normalizes spacing between paragraph elements within a container by ensuring only a single newline
     * is inserted between consecutive paragraphs. Iterates the container's child nodes, applies spacing
     * enforcement between adjacent paragraph elements, and resets tracking when non-paragraph nodes with
     * visible content are encountered.
     *
     * @param {Node | HTMLElement} parent - The container whose child nodes are inspected and adjusted for consistent paragraph spacing.
     */
    function normalizeParagraphSpacing(parent) {
        let previousParagraph = null;
        for (let node = parent.firstChild; node != null; node = node.nextSibling) {
            if (isParagraphElement(node)) {
                if (previousParagraph !== null) {
                    enforceSingleNewlineBetweenParagraphs(parent, previousParagraph, node);
                }
                previousParagraph = node;
            } else if (nodeHasVisibleContent(node)) {
                previousParagraph = null;
            }
        }
    }

    /**
     * Ensures exactly one newline text node exists between two paragraph nodes within a parent,
     * collapsing excess whitespace and removing extraneous nodes as needed.
     *
     * @param {Node} parent - The parent node containing the paragraphs and any intervening nodes.
     * @param {Node} firstParagraph - The paragraph node preceding the area to normalize.
     * @param {Node} secondParagraph - The paragraph node following the area to normalize.
     */
    function enforceSingleNewlineBetweenParagraphs(parent, firstParagraph, secondParagraph) {
        let node = firstParagraph.nextSibling;
        let newlinePlaced = false;
        while ((node != null) && (node !== secondParagraph)) {
            let next = node.nextSibling;
            if (node.nodeType === Node.TEXT_NODE) {
                if (isStringWhiteSpace(node.textContent)) {
                    if (!newlinePlaced) {
                        node.textContent = "\n";
                        newlinePlaced = true;
                    } else {
                        node.remove();
                    }
                } else {
                    newlinePlaced = false;
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (isElementWhiteSpace(node)) {
                    node.remove();
                } else {
                    newlinePlaced = false;
                }
            } else {
                node.remove();
            }
            node = next;
        }
        if (!newlinePlaced) {
            parent.insertBefore(parent.ownerDocument.createTextNode("\n"), secondParagraph);
        }
    }

    /**
     * Determines whether a given DOM node contains non-whitespace visible content.
     *
     * @param {Node|null} node - The DOM node to evaluate; can be a text node, element node, or null.
     * @returns {boolean} `true` if the node contains visible (non-whitespace) content; otherwise `false`.
     */
    function nodeHasVisibleContent(node) {
        if (node == null) {
            return false;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            return !isStringWhiteSpace(node.textContent);
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            return !isElementWhiteSpace(node);
        }
        return false;
    }

    /**
     * Determines whether the provided DOM node is a paragraph (`<p>`) element.
     *
     * @param {Node} node - The DOM node to test.
     * @returns {boolean} `true` if the node is an element node with a tag name of "p"; otherwise, `false`.
     */
    function isParagraphElement(node) {
        return (node?.nodeType === Node.ELEMENT_NODE) && (node.tagName.toLowerCase() === "p");
    }

    function removeHTMLUnknownElement(nodes) {
        let children = nodes.childNodes;
        for (let i = 0; i < children.length; i++) {
            if (children[i] instanceof HTMLUnknownElement) {
                children[i].remove();
            } else {
                removeHTMLUnknownElement(children[i]);
            }
        }
    }

    /**
     * Removes potentially scriptable content from the provided DOM element by
     * deleting any child <script> or <iframe> elements and stripping inline event
     * handlers from the element and its descendants.
     *
     * @param {Element} element - The DOM element to sanitize.
     */
    function removeScriptableElements(element) {
        removeChildElementsMatchingSelector(element, "script, iframe");
        removeEventHandlers(element);
    }

    /**
     * Cleans up content imported from Microsoft Word by flattening all "O:P" elements within the provided DOM node.
     *
     * @param {Element} element - Root DOM element to search for and sanitize "O:P" elements.
     */
    function removeMicrosoftWordCrapElements(element) {
        for (let node of getElements(element, "O:P")) {
            flattenNode(node);
        }
    }

    /**
     * Moves all child nodes of the given node to its parent and removes the node itself.
     *
     * @param {Node} node - The DOM node to flatten by hoisting its children into its parent.
     */
    function flattenNode(node) {
        while (node.hasChildNodes()) {
            node.parentNode.insertBefore(node.childNodes[0], node);
        }
        node.remove();
    }

    /**
     * Removes inline click event handlers from the specified element and all of its descendant elements.
     *
     * @todo Expand to remove ALL event handlers
     *
     * @param {Element} contentElement - The root element whose descendants will be stripped of `onclick` attributes.
     */
    function removeEventHandlers(contentElement) {
        let walker = contentElement.ownerDocument.createTreeWalker(contentElement, NodeFilter.SHOW_ELEMENT);
        let element = contentElement;
        while (element != null) {
            element.removeAttribute("onclick");
            element = walker.nextNode();
        }
    }

    /**
     * Removes height and width styling from all ancestor elements of a given element until the `<body>` is reached.
     *
     * @param {HTMLElement} element - The element whose parent chain will be traversed to clear height and width styles.
     */
    function removeHeightAndWidthStyleFromParents(element) {
        let parent = element.parentElement;
        while ((parent != null) && (parent.tagName.toLowerCase() !== "body")) {
            removeHeightAndWidthStyle(parent);
            parent = parent.parentElement;
        }
    }

    function removeHeightAndWidthStyle(element) {
        let style = element.style;
        if ((style.width !== "") || (style.height !== "")) {
            style.width = null;
            style.height = null;
            if (style.length === 0) {
                // avoid a style="" attribute in element
                element.removeAttribute("style");
            }
        }
        element.removeAttribute("width");
        element.removeAttribute("height");
    }

    /**
     * Removes common WordPress-specific UI and advertisement elements from the given DOM element.
     *
     * @param {Element} element - Root DOM element whose matching child elements should be removed.
     */
    function removeUnwantedWordpressElements(element) {
        let ccs = "div.sharedaddy, div.wpcnt, ul.post-categories, div.mistape_caption, "
            + "div.wpulike, div.wp-next-post-navi, .ezoic-adpicker-ad, .ezoic-ad, "
            + "ins.adsbygoogle";
        removeChildElementsMatchingSelector(element, ccs);
    }

    /**
     * Removes share link elements from the specified content element.
     *
     * @param {HTMLElement} contentElement - The root element whose child elements matching
     *     the selector `div.sharepost` will be removed.
     */
    function removeShareLinkElements(contentElement) {
        removeChildElementsMatchingSelector(contentElement, "div.sharepost");
    }

    function convertPreTagToPTags(dom, element, splitOn) {
        let normalizeEol = (s) => s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        splitOn = splitOn || "\n";
        let strings = normalizeEol(element.innerText).split(splitOn);
        element.innerHTML = "";
        for (let s of strings) {
            let p = dom.createElement("p");
            p.appendChild(dom.createTextNode(s));
            element.appendChild(p);
        }
    }

    function prepForConvertToXhtml(element) {
        replaceCenterTags(element);
        replaceUnderscoreTags(element);
        replaceSTags(element);
    }

    function replaceCenterTags(element) {
        for (let center of element.querySelectorAll("center")) {
            let replacement = center.ownerDocument.createElement("p");
            replacement.style.textAlign = "center";
            convertElement(center, replacement);
        }
    }

    function replaceUnderscoreTags(element) {
        for (let underscore of element.querySelectorAll("U")) {
            let replacement = underscore.ownerDocument.createElement("span");
            // ToDo: figure out how to do this by manipulating the style directly
            replacement.setAttribute("style", "text-decoration: underline;");
            convertElement(underscore, replacement);
        }
    }

    function replaceSTags(element) {
        for (let underscore of element.querySelectorAll("s")) {
            let replacement = underscore.ownerDocument.createElement("span");
            // ToDo: figure out how to do this by manipulating the style directly
            replacement.setAttribute("style", "text-decoration: line-through;");
            convertElement(underscore, replacement);
        }
    }

    /**
     * Replaces a DOM element with a provided replacement node while preserving children and attributes.
     *
     * @param {HTMLElement} element - The original element to be replaced.
     * @param {HTMLElement} replacement - The new element to insert in place of the original.
     */
    function convertElement(element, replacement) {
        let parent = element.parentElement;
        parent.insertBefore(replacement, element);
        moveChildElements(element, replacement);
        copyAttributes(element, replacement);
        element.remove();
    }

    function moveChildElements(from, to) {
        while (from.firstChild) {
            to.appendChild(from.firstChild);
        }
    }

    /**
     * Copies all attributes from a source element to a target element.
     * Silently skips attributes that cannot be set on the target.
     *
     * @param {Element} from - The source element whose attributes will be copied.
     * @param {Element} to - The target element to receive the copied attributes.
     */
    function copyAttributes(from, to) {
        for (let i = 0; i < from.attributes.length; ++i) {
            let attr = from.attributes[i];
            try {
                to.setAttribute(attr.localName, attr.value);
            } catch (e) {
                // probably invalid attribute name.  Discard
            }
        }
    }

    /**
     * Updates the `src` attribute of all images within the given element that use a delay-loading attribute.
     *
     * Iterates over descendant `<img>` elements and, when the specified delay attribute contains a non-empty URL,
     * assigns that URL to the image's `src` to trigger loading.
     *
     * @param {Element} element - The root DOM element to search for delayed images.
     * @param {string} delayAttrib - The name of the attribute holding the deferred image URL (e.g., "data-src").
     */
    function fixDelayLoadedImages(element, delayAttrib) {
        for (let i of element.querySelectorAll("img")) {
            let url = i.getAttribute(delayAttrib);
            if (!isNullOrEmpty(url)) {
                i.src = url;
            }
        }
    }

    function fixBlockTagsNestedInInlineTags(contentElement) {
        // if an inline tag contains block tags, move contents out of inline tag
        // refer https://github.com/dteviot/WebToEpub/issues/62
        let garbage = [];
        let walker = contentElement.ownerDocument.createTreeWalker(contentElement, NodeFilter.SHOW_ELEMENT);
        let element = contentElement;
        while (element != null) {
            if (isInlineElement(element) && isBlockElementInside(element)) {
                moveElementsOutsideTag(element);
                garbage.push(element);
            }
            element = walker.nextNode();
        }

        for (let g of garbage) {
            g.remove();
        }
    }

    /**
     * Checks whether the given inline element contains any descendant block-level elements.
     *
     * @param {Element} inlineElement - The DOM element to inspect for nested block elements.
     * @returns {boolean} True if a block-level descendant is found; otherwise, false.
     */
    function isBlockElementInside(inlineElement) {
        let walker = inlineElement.ownerDocument.createTreeWalker(inlineElement, NodeFilter.SHOW_ELEMENT);
        let element = null;
        while ((element = walker.nextNode())) {
            if (isBlockElement(element)) {
                return true;
            }
        }

        // if here, no block element found
        return false;
    }

    /**
     * Moves all child nodes from the given inline element to its parent (before the inline element),
     * preserving their order and normalizing any block elements nested within inline tags.
     *
     * @param {HTMLElement} inlineElement - The inline element whose child nodes should be moved to its parent.
     */
    function moveElementsOutsideTag(inlineElement) {
        while (inlineElement.hasChildNodes()) {
            let node = inlineElement.childNodes[0];
            inlineElement.parentNode.insertBefore(node, inlineElement);

            // handle case of <inline><inline><block></block></inline></inline>
            fixBlockTagsNestedInInlineTags(node);
        }
    }

    function isNodeInTag(tags, node) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return false;
        } else {
            let tagName = node.tagName.toLowerCase();
            return tags.some(t => t === tagName);
        }
    }

    /**
     * Determines whether the provided DOM node should be treated as an inline element.
     *
     * @param {Node} node - The DOM node to evaluate.
     * @returns {boolean} True if the node represents an inline element; otherwise, false.
     */
    function isInlineElement(node) {
        return isNodeInTag(INLINE_ELEMENTS, node);
    }

    function isBlockElement(node) {
        return isNodeInTag(BLOCK_ELEMENTS, node);
    }

    /**
     * Retrieves the `src` of the first <img> within the first element matching the selector under the given DOM root.
     *
     * @param {Document|Element} dom - The DOM root to search within.
     * @param {string} selector - A CSS selector used to locate a parent element.
     * @returns {string|null} The image `src` if found, otherwise `null`.
     */
    function getFirstImgSrc(dom, selector) {
        return dom.querySelector(selector)?.querySelector("img")?.src ?? null;
    }

    function extractHashFromUri(uri) {
        let index = uri.indexOf("#");
        return (index === -1) ? null : uri.substring(index + 1);
    }

    /**
     * Resolves lazy-loaded images by copying a specified data attribute to the image `src`.
     *
     * @param {Document|Element} content - Root node in which to search for images.
     * @param {string} imgCss - CSS selector matching the images to update.
     * @param {string} [attrName="data-src"] - Attribute containing the actual image URL.
     */
    function resolveLazyLoadedImages(content, imgCss, attrName) {
        attrName = attrName || "data-src";
        for (let img of content.querySelectorAll(imgCss)) {
            let dataSrc = img.getAttribute(attrName);
            if (dataSrc !== null) {
                img.src = dataSrc.trim();
            }
        }
    }

    function makeHyperlinksRelative(baseUri, content) {
        for (let link of getElements(content, "a", e => isLocalHyperlink(baseUri, e))) {
            link.href = "#" + extractHashFromUri(link.href);
        }
    }

    function isLocalHyperlink(baseUri, link) {
        return link.href.startsWith(baseUri) && (link.href.indexOf("#") !== -1);
    }

    function findPrimaryStyleSettings(element, styleProperties) {
        let characterCountForElement = function(element) {
            let count = 0;
            let child = element.firstChild;
            while (child) {
                if (child.nodeType === Node.TEXT_NODE) {
                    count += child.nodeValue.length;
                }
                child = child.nextSibling;
            }
            return count;
        };

        let findMaxCount = function(map) {
            let maxPair = [undefined, 0];
            for (let pair of map) {
                if (maxPair[1] <= pair[1]) {
                    maxPair = pair;
                }
            }
            return maxPair[0];
        };

        let mergeStyles = function(parentStyle, currentStyle, styleProperty) {
            if (currentStyle === null || currentStyle === undefined) {
                return parentStyle;
            }
            let c = currentStyle[styleProperty];
            return c !== "" ? c : parentStyle;
        };

        let updateStat = function(map, key, count) {
            let total = map.get(key);
            if (total === undefined) {
                total = 0;
            }
            map.set(key, total + count);
        };

        let walk = function(element, stats, parentStyle, styleProperties) {
            let mergedStyle = [];
            let count = characterCountForElement(element);
            for (let i = 0; i < styleProperties.length; ++i) {
                let merged = mergeStyles(parentStyle[i], element.style, styleProperties[i]);
                updateStat(stats[i], merged, count);
                mergedStyle.push(merged);
            }
            for (let i = 0; i < element.childElementCount; ++i) {
                walk(element.children[i], stats, mergedStyle, styleProperties);
            }
        };

        let stats = styleProperties.map(() => new Map());
        let initialStyle = styleProperties.map(() => undefined);

        walk(element, stats, initialStyle, styleProperties);
        return stats.map(s => findMaxCount(s));
    }

    /**
     *  Remove specified inline style value from element and its descendants
     */
    function removeStyleValue(element, styleName, value) {
        if (value === undefined) {
            return;
        }
        let walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
        do {
            let node = walker.currentNode;
            let style = node.style;
            if (style[styleName] === value) {
                style[styleName] = null;
                if (style.length === 0) {
                    node.removeAttribute("style");
                }
            }
        } while (walker.nextNode());
    }

    /** If web page is using custom font color or size, set to default */
    function setStyleToDefault(element) {
        let styleProperties = ["color", "fontSize"];
        let primary = findPrimaryStyleSettings(element, styleProperties);
        for (let i = 0; i < styleProperties.length; ++i) {
            removeStyleValue(element, styleProperties[i], primary[i]);
        }
    }

    // move up heading if higher levels are missing, i.e. h2 to h1, h3 to h2 if there's no h1.
    function removeUnusedHeadingLevels(contentElement) {
        let usedHeadings = HEADER_TAGS.map(tag => [...contentElement.querySelectorAll(tag)])
            .filter(headings => 0 < headings.length);
        for (let i = 0; i < usedHeadings.length; ++i) {
            for (let element of usedHeadings[i]) {
                let replacement = element.ownerDocument.createElement(HEADER_TAGS[i]);
                convertElement(element, replacement);
            }
        }
    }

    /**
     * wrap any raw text in <p></p> tags
     */
    function wrapRawTextNode(node) {
        if ((node.nodeType === Node.TEXT_NODE) && !isStringWhiteSpace(node.nodeValue)) {
            let wrapper = node.ownerDocument.createElement("p");
            wrapper.appendChild(node.ownerDocument.createTextNode(node.nodeValue));
            return wrapper;
        } else {
            return node;
        }
    }

    /**
     * Determines whether a given value is null or an empty/whitespace-only string.
     *
     * @param {*} s - The value to test.
     * @returns {boolean} True if the value is null, undefined, or a string containing only whitespace; otherwise, false.
     */
    function isNullOrEmpty(s) {
        return ((s == null) || isStringWhiteSpace(s));
    }

    /**
     * Converts hyperlinks within a content element into a list of chapter objects.
     *
     * It filters out links without text or href, ignores duplicates (by normalized URL),
     * and optionally applies a predicate to determine whether a link is a chapter.
     * It can also group chapters into arcs by tracking changes returned from `getChapterArc`.
     *
     * @param {Element|null} contentElement - The root element containing anchor tags to process.
     * @param {(link: HTMLAnchorElement) => boolean} [isChapterPredicate] - Optional predicate to decide if a link represents a chapter.
     * @param {(link: HTMLAnchorElement) => any} [getChapterArc] - Optional function to derive the chapter arc; changes in returned value mark new arcs.
     * @returns {Array} An array of chapter entries produced from the valid hyperlinks.
     */
    function hyperlinksToChapterList(contentElement, isChapterPredicate, getChapterArc) {
        if (contentElement == null) {
            return [];
        }

        let linkSet = new Set();
        let includeLink = function(link) {
            // ignore links with no name or link
            if (isNullOrEmpty(link.innerText) || isNullOrEmpty(link.href)) {
                return false;
            }

            // ignore duplicate links
            let href = normalizeUrlForCompare(link.href);
            if (linkSet.has(href)) {
                return false;
            }

            linkSet.add(href);
            return isChapterPredicate ? isChapterPredicate(link) : true;
        };

        // only set newArc when arc changes
        let currentArc = null;
        let newArcValueForChapter = function(link) {
            if (getChapterArc) {
                let arc = getChapterArc(link);
                if (arc === currentArc) {
                    return null;
                } else {
                    currentArc = arc;
                    return currentArc;
                }
            }

            return currentArc;
        };

        return getElements(contentElement, "a", a => includeLink(a))
            .map(link => hyperLinkToChapter(link, newArcValueForChapter(link)));
    }

    function removeTrailingSlash(url) {
        return url.endsWith("/") ? url.substring(0, url.length - 1) : url;
    }

    function removeAnchor(url) {
        let index = url.indexOf("#");
        return (0 <= index) ? url.substring(0, index) : url;
    }

    function normalizeUrlForCompare(url) {
        let noTrailingSlash = removeTrailingSlash(removeAnchor(url));

        const protocolSeparator = "://";
        let protocolIndex = noTrailingSlash.indexOf(protocolSeparator);
        return (protocolIndex < 0) ? noTrailingSlash
            : noTrailingSlash.substring(protocolIndex + protocolSeparator.length);
    }

    function hyperLinkToChapter(link, newArc) {
        return {
            sourceUrl: link.href,
            title: link.innerText.trim(),
            newArc: (newArc === undefined) ? null : newArc
        };
    }

    function createComment(doc, content) {
        content = clearIfDataUri(content);
        // comments are not allowed to contain a double hyphen
        let escaped = content.replace(/--/g, "%2D%2D");
        return doc.createComment("  " + escaped + "  ");
    }

    /**
     * Adds an XML declaration processing instruction to the start of the given DOM document.
     * @param {Document} dom - The DOM document to prepend with the XML declaration.
     */
    function addXmlDeclarationToStart(dom) {
        // As JavaScript doesn't support this directly, need to do a dirty hack using
        // a processing instruction
        // see https://bugzilla.mozilla.org/show_bug.cgi?id=318086
        let declaration = dom.createProcessingInstruction("xml", "version=\"1.0\" encoding=\"utf-8\"");
        dom.insertBefore(declaration, dom.childNodes[0]);
    }

    function addXhtmlDocTypeToStart(dom) {
        // So that we don't get weird as hell issues with certain tags we use a dirty hack to add a doctype
        let docType = dom.implementation.createDocumentType("html", "-//W3C//DTD XHTML 1.1//EN", "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd");
        dom.insertBefore(docType, dom.children[0]);
    }

    /**
     * Determines whether the provided string contains only whitespace characters (or is empty).
     *
     * @param {string} s - The string to evaluate.
     * @returns {boolean} Returns `true` if the string has no non-whitespace characters; otherwise, `false`.
     */
    function isStringWhiteSpace(s) {
        return !(/\S/.test(s));
    }

    /**
     * Determines whether the given DOM element contains only whitespace content.
     *
     * Treats text nodes consisting solely of whitespace as white space,
     * ignores comment nodes, and considers elements containing images (directly
     * or nested) as non-whitespace.
     *
     * @param {Node} element - The DOM node to evaluate.
     * @returns {boolean} True if the element contains only whitespace (or is a comment); otherwise, false.
     */
    function isElementWhiteSpace(element) {
        switch (element.nodeType) {
            case Node.TEXT_NODE:
                return isStringWhiteSpace(element.textContent);
            case Node.COMMENT_NODE:
                return true;
        }
        if ((element.tagName === "IMG") || (element.tagName === "image")) {
            return false;
        }
        if (element.querySelector("img, image") !== null) {
            return false;
        }
        return isStringWhiteSpace(element.innerText);
    }

    /**
     * Determines whether the provided DOM node is an HTML header element.
     *
     * @param {Node} node - The DOM node to test.
     * @returns {boolean} True if the node is an element whose tag matches one of the header tags; otherwise, false.
     */
    function isHeaderTag(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }
        let tag = node.tagName.toLowerCase();
        return HEADER_TAGS.some(t => tag === t);
    }

    /**
     * Determines whether the provided string is a valid HTTP or HTTPS URL.
     * @param {string} string - The string to validate as a URL.
     * @returns {boolean} True if the string is a valid HTTP/HTTPS URL; otherwise, false.
     */
    function isUrl(string) {
        try {
            let url = new URL(string);
            return url.protocol.startsWith("http:")
                || url.protocol.startsWith("https:");
        } catch (e) {
            return false;
        }
    }

    /**
     * Converts an XML DOM document into a serialized string after ensuring it has an XML declaration.
     *
     * @param {Document} dom - The XML DOM to serialize. This document is modified to include an XML declaration if missing.
     * @returns {string} The serialized XML as a string.
     */
    function xmlToString(dom) {
        addXmlDeclarationToStart(dom);
        return new XMLSerializer().serializeToString(dom);
    }

    /**
     * Pads the given number with leading zeros to ensure a fixed length of four characters.
     *
     * @param {number} num - The number to pad.
     * @returns {string} The zero-padded string representation of the number.
     */
    function zeroPad(num) {
        let padded = "000" + num;
        padded = padded.substring(padded.length - 4, padded.length);
        return padded;
    }

    function iterateElements(root, filter, whatToShow = NodeFilter.SHOW_ELEMENT) {
        let iterator = document.createNodeIterator(root,
            whatToShow,
            { acceptNode: filter }
        );
        let elements = [];
        let node = null;
        while ((node = iterator.nextNode()) != null) {
            elements.push(node);
        }
        return elements;
    }

    function getElements(dom, tagName, filter) {
        let array = Array.from(dom.getElementsByTagName(tagName));
        return (filter === undefined || typeof filter !== "function")
            ? array : array.filter(filter);
    }

    function getElement(dom, tagName, filter) {
        let elements = getElements(dom, tagName, filter);
        return (elements.length === 0) ? null : elements[0];
    }

    /**
     *   Used in removeNextAndPreviousChapterHyperlinks()
     *   Basically, we want to remove all elements related to the hyperlink
     *   So we want to remove the parent element. However, need to be careful
     *   we don't go so high we wipe out the entire document
     */
    function moveIfParent(element, parentTag) {
        let parent = element.parentNode;
        if ((parent.tagName.toLowerCase() === parentTag) &&
            (parent.textContent.length < 200)) {
            return parent;
        }
        return element;
    }

    /**
     * Sanitizes a string to be safe for use as a filename by replacing spaces and no-break spaces
     * with underscores, removing disallowed characters, preserving common punctuation, and optionally
     * truncating long names with an ellipsis in the middle to respect a maximum length.
     *
     * @param {string} title - The original filename candidate to sanitize.
     * @param {number} [maxLength=20] - The maximum allowed length of the resulting filename.
     * @returns {string} A filesystem-safe filename derived from the provided title.
     */
    function safeForFileName(title, maxLength = 20) {
        if (title) {
            // // Allow only a-z regardless of case and numbers as well as hyphens and underscores; replace spaces and no-break spaces with underscores
            // title = title.replace(/[ \u00a0]/gi, "_").replace(/([^a-z0-9_-]+)/gi, "");

            // Allow common punctuation while keeping filenames filesystem safe
            title = title.replace(/\//g, "+");
            // eslint-disable-next-line no-useless-escape -- character class intentionally lists the punctuation we want to preserve
            title = title.replace(/[ \u00a0]/gi, "_").replace(/([^a-z0-9_'"\-\+\&\(\)\[\]\{\}!\?]+)/gi, "");
            // There is technically a 255-character limit in Windows for file paths.
            // So we will allow files to have 20 characters and when they go over we split them
            // we then truncate the middle so that the file name is always different
            const ellipsis = "...";
            let splitLength = Math.floor((maxLength - ellipsis.length) / 2);
            return title.length > maxLength
                ? title.slice(0, splitLength) + ellipsis + title.slice(title.length - splitLength)
                : title;
        }
        return "";
    }

    /**
     * Creates a storage file path by combining a subdirectory, zero-padded index,
     * an optional sanitized title, and an extension.
     *
     * @param {string} subdirectory - The directory path prefix for the file.
     * @param {number} index - The numeric index to include, zero-padded.
     * @param {string} [title] - Optional title to include; sanitized and suffixed with a dot if provided.
     * @param {string} extension - The file extension (without the leading dot if the title is provided).
     * @returns {string} The assembled storage file name/path.
     */
    function makeStorageFileName(subdirectory, index, title, extension) {
        if (title) {
            const safeLengthForNameInZip = 200;
            title = "_" + safeForFileName(title, safeLengthForNameInZip) + ".";
        } else {
            // We don't want issues so just set it to . to prepare for the extension
            title = ".";
        }
        return subdirectory + zeroPad(index) + title + extension;
    }

    function isTextAreaField(element) {
        return (element.tagName === "TEXTAREA");
    }

    function isTextInputField(element) {
        return (element.tagName === "INPUT") &&
            ((element.type === "text") || (element.type === "url"));
    }

    function isXhtmlInvalid(xhtmlAsString, mimeType = "application/xml") {
        let doc = new DOMParser().parseFromString(xhtmlAsString, mimeType);
        let parserError = doc.querySelector("parsererror");
        return (parserError === null) ? null : parserError.textContent;
    }

    function dctermsToTable(dom) {
        let table = dom.createElement("table");
        let body = dom.createElement("tbody");
        table.appendChild(body);
        for (let term of dom.querySelectorAll("meta[name*='dcterms.']")) {
            let row = dom.createElement("tr");
            body.appendChild(row);
            let td = dom.createElement("td");
            row.appendChild(td);
            td.textContent = term.getAttribute("name").replace("dcterms.", "");
            td = dom.createElement("td");
            row.appendChild(td);
            td.textContent = term.getAttribute("content");
        }
        return table;
    }

    function parseHtmlAndInsertIntoContent(htmlText, content) {
        let parsed = util.sanitize(htmlText);
        while (content.firstChild) {
            content.removeChild(content.firstChild);
        }
        for (const tag of [...parsed.querySelector("body").children]) {
            content.appendChild(tag);
        }
    }

    /**
     * Logs the provided argument for debugging purposes.
     * Allows disabling logging from one place
     *
     * @param {*} arg - The value to log.
     */
    function log(arg) { // eslint-disable-line no-unused-vars
        // ToDo: uncomment this for debug logging
        // console.log(arg);
    }

    // This is for Unit Testing only
    function syncLoadSampleDoc(fileName, url) {
        let xhr = new XMLHttpRequest();
        xhr.open("GET", fileName, false);
        xhr.send(null);
        let dom = new DOMParser().parseFromString(xhr.responseText, "text/html");
        setBaseTag(url, dom);
        return dom;
    }

    function styleSheetFileName() {
        return "OEBPS/Styles/stylesheet.css";
    }

    function extractUrlFromBackgroundImage(element) {
        const background = element?.style?.backgroundImage;
        return background?.substring(5, background.length - 2) ?? null;
    }

    function extractSubstring(s, prefix, suffix) {
        if (typeof (prefix) !== "string") {
            let match = s.match(prefix);
            if (match === null) {
                throw new Error("prefix not found");
            } else {
                prefix = match[0];
            }
        }

        let i = s.indexOf(prefix);
        if (i < 0) {
            throw new Error("prefix not found");
        }
        s = s.substring(i + prefix.length);
        i = s.indexOf(suffix);
        if (i < 0) {
            throw new Error("suffix not found");
        }
        return s.substring(0, i);
    }

    function findIndexOfClosingQuote(s, startIndex) {
        let index = startIndex + 1;
        while (index < s.length && (s[index] !== "\"")) {
            index += (s[index] === "\\") ? 2 : 1;
        }
        return index;
    }

    function findIndexOfClosingBracket(s, startIndex) {
        let index = startIndex + 1;
        let depth = 1;
        let c = s[index];
        while (0 < depth && index < s.length) {
            if (c === "]" || c === "}") {
                --depth;
                if (depth === 0) {
                    return index;
                }
            } else if (c === "[" || c === "{") {
                ++depth;
            } else if (c === "\"") {
                index = findIndexOfClosingQuote(s, index);
            }
            ++index;
            c = s[index];
        }
        // unbalanced brackets
        return -1;
    }

    /** locate and extract JSON that is embedded in a string
     * @param {string} s - show/hide control
     * @param {string} prefix - text that precedes the embedded JSON
     */
    function locateAndExtractJson(s, prefix) {
        const findOpeningBracket = function(s, index) {
            while (index < s.length) {
                let ch = s[index];
                if ((ch === "[") || (ch === "{")) {
                    return index;
                }
                ++index;
            }
            return -1;
        };

        let index = s.indexOf(prefix);
        if (0 <= index) {
            index = findOpeningBracket(s, index + prefix.length);
            if (0 <= index) {
                let end = findIndexOfClosingBracket(s, index);
                if (index < end) {
                    let jsonString = s.substring(index, end + 1);
                    return JSON.parse(jsonString);
                }
            }
        }
        return null;
    }

    function createChapterTab(url) {
        return new Promise((resolve) => {
            chrome.tabs.create({url: url, active: false}, (tab) => {
                resolve(tab.id);
            });
        });
    }

    /**
     * Removes one or more attributes from a DOM element.
     *
     * @param {Element} element - The DOM element from which attributes will be removed.
     * @param {string|string[]} attributeNames - A single attribute name or an array of attribute names to remove.
     */
    function removeAttributes(element, attributeNames) {
        if (!element || attributeNames == null) return;

        // Handle single attribute name as string
        if (typeof attributeNames === "string") {
            element.removeAttribute(attributeNames);
            return;
        }

        // Handle array of attribute names
        if (Array.isArray(attributeNames)) {
            for (const name of attributeNames) {
                if (typeof name === "string") {
                    element.removeAttribute(name);
                }
            }
        }
    }

    /**
     * Removes attributes with empty string values from all elements within the provided DOM fragment.
     *
     * @param {Document|Element} content - A DOM root (e.g., Document, DocumentFragment, or Element) whose descendants will be cleaned of empty attributes.
     * @returns {void}
     */
    function removeEmptyAttributes(content) {
        const elements = content.querySelectorAll("*");

        for (const element of elements) {
            const attributes = element.attributes;
            const attributesToRemove = [];

            for (let i = 0; i < attributes.length; i++) {
                if (attributes[i].value.trim() === "") {
                    attributesToRemove.push(attributes[i].name);
                }
            }

            for (let i = attributesToRemove.length - 1; i >= 0; i--) {
                element.removeAttribute(attributesToRemove[i]);
            }
        }
    }

    /**
     * Removes empty `<span>` elements from `<p>` and `<div>` containers within the provided DOM subtree.
     * For each `<span>` inside a paragraph or div that has no attributes, its child nodes are promoted
     * to the parent before the span itself is removed.
     *
     * @param {Document|Element} content - The root DOM node to search for spans to normalize.
     */
    function removeSpansWithNoAttributes(content) {
        // within p or div tags, spans with no attributes have no purpose
        const spans = content.querySelectorAll("p span, div span");

        for (const span of spans) {
            if (span.attributes.length === 0) {
                while (span.firstChild) {
                    span.parentNode.insertBefore(span.firstChild, span);
                }
                span.parentNode.removeChild(span);
            }
        }
    }

    /**
     * Converts semantic inline styles on an element into corresponding HTML tags and optionally cleans up remaining styles.
     *
     * Scans the element's inline style for italic, bold, underline, and line-through declarations, wraps inner content
     * with the matching semantic tags (`<i>`, `<b>`, `<u>`, `<s>`), and removes those style declarations. Non-semantic
     * font-weight values (normal or 100–400) are removed. Remaining styles are retained unless `removeLeftoverStyles`
     * is false and only a centered text-align style persists.
     *
     * @param {HTMLElement} element - The element whose semantic inline styles should be converted to tags.
     * @param {boolean} [removeLeftoverStyles=false] - Whether to remove any leftover non-semantic style declarations.
     */
    function replaceSemanticInlineStylesWithTags(element, removeLeftoverStyles = false) {
        if (element.hasAttribute("style")) {
            let styleText = element.getAttribute("style");

            // Map of style patterns to their semantic HTML equivalents
            const styleToTag = [
                { regex: /font-style\s*:\s*(italic|oblique)\s*;?/g, tag: "i" },
                { regex: /font-weight\s*:\s*(bold|[7-9]\d\d)\s*;?/g, tag: "b" },
                { regex: /text-decoration\s*:\s*underline\s*;?/g, tag: "u" },
                { regex: /text-decoration\s*:\s*line-through\s*;?/g, tag: "s" }
            ];

            // Apply semantic tags and remove corresponding styles
            for (const style of styleToTag) {
                if (style.regex.test(styleText)) {
                    // Reset lastIndex since test() advances it
                    style.regex.lastIndex = 0;
                    wrapInnerContentInTag(element, style.tag);
                    styleText = styleText.replace(style.regex, "");
                }
            }

            // Remove non-semantic font-weight
            styleText = styleText.replace(/font-weight\s*:\s*(normal|[1-4]\d\d)\s*;?/g, "");
            styleText = styleText.trim();

            if (styleText && (!removeLeftoverStyles || /italic|bold|font-weight|underline|line-through/.test(styleText))) {
                element.setAttribute("style", styleText);
            } else {
                // Remove all remaining styles except text-align:center if present
                element.style.getPropertyValue("text-align") === "center"
                    ? element.setAttribute("style", "text-align: center;")
                    : element.removeAttribute("style");
            }
        }
    }

    /**
     * Wraps all child elements of the specified element inside a newly created wrapper element.
     *
     * @param {Element} element - The DOM element whose child elements will be wrapped.
     * @param {string} tagName - The tag name of the wrapper element to create.
     */
    function wrapInnerContentInTag(element, tagName) {
        const wrapper = document.createElement(tagName);
        moveChildElements(element, wrapper);
        element.appendChild(wrapper);
    }

    /**
     * Retrieves the default file extension for a given MIME type.
     *
     * @param {string} mimeType - The MIME type to look up.
     * @returns {string|undefined} The default file extension, or undefined if no match is found.
     */
    function getDefaultExtensionByMime(mimeType) {
        let retval = MIME_TYPE_EXTENSIONS[mimeType];
        if (retval) retval = retval[0];
        return retval;
    }

    /**
     * Detects the MIME type of base64-encoded data by matching known file
     * signatures in the provided string against predefined `MIME_TYPE_SIGNATURES`.
     *
     * @param {string} b64 - Base64-encoded string to inspect.
     * @returns {string|undefined} The detected MIME type if a signature matches; otherwise `undefined`.
     */
    function detectMimeType(b64) {
        let b64b = atob(b64);
        for (var s in MIME_TYPE_SIGNATURES) {
            if (b64b.indexOf(atob(s)) === 0 || b64.indexOf(s) === 0) {
                return MIME_TYPE_SIGNATURES[s][0];
            }
        }
    }

    /**
     * Sanitizes potentially unsafe HTML content while preserving its original base URI.
     *
     * The input is passed through DOMPurify for sanitization, then parsed into a new
     * `Document`. If the original content had a `baseURI`, a `<base>` tag is injected
     * to maintain correct relative URL resolution.
     *
     * @param {string|Document} dirty - Raw HTML content or document to sanitize.
     * @returns {Document} A sanitized HTML document with the original base URI restored.
     */
    function sanitize(dirty) {
        let savedBaseURI = dirty.baseURI;
        const clean = DOMPurify.sanitize(dirty);
        let html = new DOMParser().parseFromString(clean, "text/html");
        if (savedBaseURI) {
            util.setBaseTag(savedBaseURI, html);
        }
        return html;
    }

    /**
     * Sanitizes a DOM node by cloning text nodes or purifying element nodes.
     *
     * If the input node is a text node, it is cloned to preserve whitespace that
     * might otherwise be removed by the sanitizer. For other node types, the node
     * is sanitized and the first sanitized child is returned.
     *
     * @param {Node} dirtyNode - The potentially unsafe DOM node to sanitize.
     * @returns {Node} A safe clone of the text node or the first child of the sanitized node.
     */
    function sanitizeNode(dirtyNode) {
        // don't need to sanitize text nodes
        // and DOMPurify deletes them if they're whitespace
        return (dirtyNode?.nodeType === 3)
            ? dirtyNode.cloneNode(true)
            : sanitize(dirtyNode).body.firstChild;
    }



    // ------------------------------
    // ------ Define constants ------
    // ------------------------------

    /**
     * XML namespace URI for XHTML elements used throughout the plugin.
     * @constant {string}
     */
    const XMLNS = "http://www.w3.org/1999/xhtml";

    /**
     * Array of HTML inline element tag names recognized by the utility module.
     * Includes semantic inline elements, form controls, media, and formatting tags
     * used to identify elements that should be treated as inline content.
     *
     * It's ugly, but we're treating <u> and <s> as inline (they are not)
     */
    const INLINE_ELEMENTS = ["b", "big", "i", "small", "tt", "abbr", "acronym", "cite",
        "code", "dfn", "em", "kbd", "strong", "samp", "time", "var", "a", "bdo",
        "br", "img", "map", "object", "q", "script", "span", "sub", "sup",
        "button", "input", "label", "select", "textarea", "u", "s"];

    /**
     * List of HTML tag names considered as block-level elements.
     * Used for layout or parsing logic to identify elements that should
     * start on a new line in typical document flow.
     */
    const BLOCK_ELEMENTS = ["address", "article", "aside", "blockquote", "canvas",
        "dd", "div", "dl", "fieldset", "figcaption", "figure", "footer",
        "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr",
        "li", "main", "nav", "noscript", "ol", "output", "p", "pre",
        "section", "table", "tfoot", "ul", "video"];

    const HEADER_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

    /**
     * Maps common image MIME types to their corresponding filename extensions.
     *
     * @constant
     * @type {Object<string, string[]>}
     * @property {string[]} image/jpeg           - Extensions: jpg, jpeg, jpe.
     * @property {string[]} image/png            - Extensions: png.
     * @property {string[]} image/gif            - Extensions: gif.
     * @property {string[]} image/webp           - Extensions: webp.
     * @property {string[]} image/bmp            - Extensions: bmp, dib.
     * @property {string[]} image/tiff           - Extensions: tif, tiff.
     * @property {string[]} image/svg+xml        - Extensions: svg.
     * @property {string[]} image/x-icon         - Extensions: ico.
     * @property {string[]} image/vnd.microsoft.icon - Extensions: ico.
     * @property {string[]} image/heif           - Extensions: heif.
     * @property {string[]} image/heic           - Extensions: heic.
     * @property {string[]} image/x-xbitmap      - Extensions: xbm.
     * @property {string[]} image/x-portable-bitmap   - Extensions: pbm.
     * @property {string[]} image/x-portable-graymap  - Extensions: pgm.
     * @property {string[]} image/x-portable-pixmap   - Extensions: ppm.
     * @property {string[]} image/x-portable-anymap   - Extensions: pnm.
     * @property {string[]} image/x-cmu-raster    - Extensions: ras.
     * @property {string[]} image/x-tga           - Extensions: tga.
     * @property {string[]} image/jxr             - Extensions: jxr.
     * @property {string[]} image/ktx             - Extensions: ktx.
     * @property {string[]} image/apng            - Extensions: apng.
     * @property {string[]} image/avif            - Extensions: avif.
     */
    const MIME_TYPE_EXTENSIONS = {
        "image/jpeg": ["jpg", "jpeg", "jpe"],
        "image/png": ["png"],
        "image/gif": ["gif"],
        "image/webp": ["webp"],
        "image/bmp": ["bmp", "dib"],
        "image/tiff": ["tif", "tiff"],
        "image/svg+xml": ["svg"],
        "image/x-icon": ["ico"],
        "image/vnd.microsoft.icon": ["ico"],
        "image/heif": ["heif"],
        "image/heic": ["heic"],
        "image/x-xbitmap": ["xbm"],
        "image/x-portable-bitmap": ["pbm"],
        "image/x-portable-graymap": ["pgm"],
        "image/x-portable-pixmap": ["ppm"],
        "image/x-portable-anymap": ["pnm"],
        "image/x-cmu-raster": ["ras"],
        "image/x-tga": ["tga"],
        "image/jxr": ["jxr"],
        "image/ktx": ["ktx"],
        "image/apng": ["apng"],
        "image/avif": ["avif"]
    };

    /**
     * Maps base64-encoded magic number prefixes to an array of corresponding MIME types.
     * Keys represent the leading bytes of file signatures encoded in base64, while values
     * list one or more MIME types that share that signature.
     * Useful for inferring image MIME types when only the raw binary signature is available.
     */
    const MIME_TYPE_SIGNATURES = {
        "/9j/": ["image/jpeg"],
        "iVBORw0KGgo=": ["image/png", "image/apng"],
        "R0lGODdh": ["image/gif"],
        "R0lGODlh": ["image/gif"],
        "UklGRg": ["image/webp"],
        "Qk0=": ["image/bmp"],
        "SUkqAA==": ["image/tiff"],
        "TU0AKg==": ["image/tiff"],
        "PD94bWw=": ["image/svg+xml"],
        "AAABAA==": ["image/x-icon", "image/vnd.microsoft.icon"],
        "ZnR5cGhlaWZj": ["image/heif"],
        "ZnR5cG1pZjE=": ["image/heif"],
        "ZnR5cGhlaWNj": ["image/heic"],
        "SUm8": ["image/jxr"],
        "q0tUWCAxMb0NCgo=": ["image/ktx"],
        "AAACAA==": ["image/x-tga"],
        "ZnR5cGF2aWY=": ["image/avif"],
        "UDAx": ["image/x-portable-bitmap"],
        "UDAy": ["image/x-portable-graymap"],
        "UDAz": ["image/x-portable-pixmap"],
        "UDA0": ["image/x-portable-anymap"],
        "WaZqlQ==": ["image/x-cmu-raster"]
    };

    return {
        XMLNS: XMLNS,
        INLINE_ELEMENTS: INLINE_ELEMENTS,
        BLOCK_ELEMENTS: BLOCK_ELEMENTS,
        HEADER_TAGS: HEADER_TAGS,
        sleep: sleep,
        sleepController: sleepController,
        randomInteger: randomInteger,
        isFirefox: isFirefox,
        extensionVersion: extensionVersion,
        createEmptyXhtmlDoc: createEmptyXhtmlDoc,
        createEmptyHtmlDoc: createEmptyHtmlDoc,
        populateHead: populateHead,
        createSvgImageElement: createSvgImageElement,
        clearIfDataUri: clearIfDataUri,
        resolveRelativeUrl: resolveRelativeUrl,
        log: log,
        extractHostName: extractHostName,
        extractFilename: extractFilename,
        extractFilenameFromUrl: extractFilenameFromUrl,
        getParamFromUrl: getParamFromUrl,
        setBaseTag: setBaseTag,
        decodeCloudflareProtectedEmails: decodeCloudflareProtectedEmails,
        replaceCloudflareProtectedLink: replaceCloudflareProtectedLink,
        decodeEmail: decodeEmail,
        removeElements: removeElements,
        removeChildElementsMatchingSelector: removeChildElementsMatchingSelector,
        removeComments: removeComments,
        removeEmptyDivElements: removeEmptyDivElements,
        removeTrailingWhiteSpace: removeTrailingWhiteSpace,
        removeLeadingWhiteSpace: removeLeadingWhiteSpace,
        trimTextContent: trimTextContent,
        removeHTMLUnknownElement: removeHTMLUnknownElement,
        removeScriptableElements: removeScriptableElements,
        removeMicrosoftWordCrapElements: removeMicrosoftWordCrapElements,
        flattenNode: flattenNode,
        removeEventHandlers: removeEventHandlers,
        removeHeightAndWidthStyleFromParents: removeHeightAndWidthStyleFromParents,
        removeHeightAndWidthStyle: removeHeightAndWidthStyle,
        removeUnwantedWordpressElements: removeUnwantedWordpressElements,
        removeShareLinkElements: removeShareLinkElements,
        convertPreTagToPTags: convertPreTagToPTags,
        prepForConvertToXhtml: prepForConvertToXhtml,
        replaceCenterTags: replaceCenterTags,
        replaceUnderscoreTags: replaceUnderscoreTags,
        replaceSTags: replaceSTags,
        convertElement: convertElement,
        moveChildElements: moveChildElements,
        copyAttributes: copyAttributes,
        fixDelayLoadedImages: fixDelayLoadedImages,
        fixBlockTagsNestedInInlineTags: fixBlockTagsNestedInInlineTags,
        isBlockElementInside: isBlockElementInside,
        moveElementsOutsideTag: moveElementsOutsideTag,
        isNodeInTag: isNodeInTag,
        isInlineElement: isInlineElement,
        isBlockElement: isBlockElement,
        getFirstImgSrc: getFirstImgSrc,
        makeRelative: makeRelative,
        makeStorageFileName: makeStorageFileName,
        extractHashFromUri: extractHashFromUri,
        makeHyperlinksRelative: makeHyperlinksRelative,
        resolveLazyLoadedImages: resolveLazyLoadedImages,
        isLocalHyperlink: isLocalHyperlink,
        findPrimaryStyleSettings: findPrimaryStyleSettings,
        removeStyleValue: removeStyleValue,
        setStyleToDefault: setStyleToDefault,
        removeUnusedHeadingLevels: removeUnusedHeadingLevels,
        isNullOrEmpty: isNullOrEmpty,
        wrapRawTextNode: wrapRawTextNode,
        hyperlinksToChapterList: hyperlinksToChapterList,
        removeTrailingSlash: removeTrailingSlash,
        removeAnchor: removeAnchor,
        normalizeUrlForCompare: normalizeUrlForCompare,
        hyperLinkToChapter: hyperLinkToChapter,
        createComment: createComment,
        addXmlDeclarationToStart: addXmlDeclarationToStart,
        addXhtmlDocTypeToStart: addXhtmlDocTypeToStart,
        iterateElements: iterateElements,
        getElement: getElement,
        getElements: getElements,
        moveIfParent: moveIfParent,
        safeForFileName: safeForFileName,
        styleSheetFileName: styleSheetFileName,
        isStringWhiteSpace: isStringWhiteSpace,
        isElementWhiteSpace: isElementWhiteSpace,
        isHeaderTag: isHeaderTag,
        isUrl: isUrl,
        isTextAreaField: isTextAreaField,
        isTextInputField: isTextInputField,
        isXhtmlInvalid: isXhtmlInvalid,
        dctermsToTable: dctermsToTable,
        parseHtmlAndInsertIntoContent: parseHtmlAndInsertIntoContent,
        extractUrlFromBackgroundImage: extractUrlFromBackgroundImage,
        extractSubstring: extractSubstring,
        findIndexOfClosingQuote: findIndexOfClosingQuote,
        findIndexOfClosingBracket: findIndexOfClosingBracket,
        locateAndExtractJson: locateAndExtractJson,
        createChapterTab: createChapterTab,
        syncLoadSampleDoc: syncLoadSampleDoc,
        xmlToString: xmlToString,
        zeroPad: zeroPad,
        sanitize: sanitize,
        sanitizeNode: sanitizeNode,
        removeAttributes: removeAttributes,
        removeEmptyAttributes: removeEmptyAttributes,
        removeSpansWithNoAttributes: removeSpansWithNoAttributes,
        ensureSingleNewlineBetweenParagraphs: ensureSingleNewlineBetweenParagraphs,
        replaceSemanticInlineStylesWithTags: replaceSemanticInlineStylesWithTags,
        wrapInnerContentInTag: wrapInnerContentInTag,
        getDefaultExtensionByMime: getDefaultExtensionByMime,
        detectMimeType: detectMimeType
    };
})();
