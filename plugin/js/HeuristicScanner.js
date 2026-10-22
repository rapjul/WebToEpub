"use strict";

/**
 * Heuristic DOM scanner that auto-detects chapter content and title CSS selectors
 * for unrecognized sites using `DefaultParser`.
 */
class HeuristicScanner {
    /**
     * Scans a target URL or preloaded DOM document to detect content and title CSS selectors.
     *
     * @param {string} url - The chapter URL to scan.
     * @param {Document|null} [preloadedDoc=null] - Optional preloaded DOM document to avoid network requests.
     * @returns {Promise<{ status: string, contentCss?: string, titleCss?: string, error?: string }>} Scan result.
     */
    static async scan(url, preloadedDoc = null) {
        try {
            let doc = preloadedDoc;

            if (!doc) {
                let xhr = await HttpClient.fetchHtml(url);
                doc = xhr.responseXML;
            }

            if (!doc) {
                return { status: "failed", error: "Failed to parse DOM" };
            }

            // Check whether the page is a table of contents.
            if (HeuristicScanner.isTableOfContents(doc)) {
                return { status: "toc_detected" };
            }

            let contentNode = HeuristicScanner.findContentNode(doc);
            let contentCss = contentNode ? HeuristicScanner.generateSelector(contentNode) : "body";

            let titleNode = HeuristicScanner.findTitleNode(doc);
            let titleCss = titleNode ? HeuristicScanner.generateSelector(titleNode) : "";

            return {
                status: "success",
                contentCss: contentCss,
                titleCss: titleCss
            };

        } catch (error) {
            return { status: "failed", error: error.message };
        }
    }

    /**
     * Determines whether a document appears to be a Table of Contents page based on link text density.
     *
     * @param {Document} doc - The DOM document to evaluate.
     * @returns {boolean} `true` if link text exceeds 40% of total visible text length.
     */
    static isTableOfContents(doc) {
        let walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        let totalTextLength = 0;
        let linkTextLength = 0;

        while ((node = walker.nextNode())) {
            let text = node.textContent.trim();
            if (text.length === 0) continue;
            totalTextLength += text.length;

            if (node.parentElement && node.parentElement.closest("a")) {
                linkTextLength += text.length;
            }
        }

        return totalTextLength > 0 && (linkTextLength / totalTextLength) > 0.4;
    }

    /**
     * Locates the most likely main chapter content element in the document using paragraph/line-break scoring.
     *
     * @param {Document} doc - The DOM document to search.
     * @returns {Element|null} The best candidate content element, or `null` if none found.
     */
    static findContentNode(doc) {
        let candidates = [];
        let walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, null, false);
        let node;

        const badPatterns = /comment|footer|sidebar|menu|nav|ad|promo|widget|\u8BC4\u8BBA|\u63A8\u8350|\u7559\u8A00|\u30B3\u30E1\u30F3\u30C8|\uB313\uAE00/i;
        const goodPatterns = /content|chapter|article|text|body|\u6B63\u6587|\u5185\u5BB9|\u672C\u7DE8|\u672C\u6587/i;

        while ((node = walker.nextNode())) {
            let tag = node.tagName.toLowerCase();
            if (["script", "style", "nav", "header", "footer"].includes(tag)) continue;

            let pCount = node.getElementsByTagName("p").length;
            let brCount = node.getElementsByTagName("br").length;

            if (pCount > 2 || brCount > 4) {
                let className = node.className || "";
                let id = node.id || "";
                let attrString = `${className} ${id}`;

                if (badPatterns.test(attrString)) continue;

                let score = pCount * 2 + brCount;
                if (goodPatterns.test(attrString)) {
                    score += 50;
                }
                candidates.push({ node, score });
            }
        }

        if (candidates.length === 0) return null;

        // Sort by score descending
        candidates.sort((a, b) => b.score - a.score);

        // Innermost Node Wins logic (Child > Parent)
        let bestCandidate = candidates[0];

        for (let i = 1; i < candidates.length; i++) {
            let challenger = candidates[i];

            // If the challenger has the same or very similar score (e.g., >= 80% of best score)
            if (challenger.score >= bestCandidate.score * 0.8) {
                // If the current best candidate contains the challenger, the challenger is deeper.
                // It means the parent is just an outer wrapper. We prefer the deeper node.
                if (bestCandidate.node.contains(challenger.node)) {
                    bestCandidate = challenger;
                }
            } else {
                // Since candidates are sorted by score, we can break early if scores drop too low.
                break;
            }
        }

        return bestCandidate.node;
    }

    /**
     * Locates the most likely chapter title element in the document.
     *
     * @param {Document} doc - The DOM document to search.
     * @returns {Element|null} The best candidate title element, or `null` if none found.
     */
    static findTitleNode(doc) {
        // Added h1, h2 to match patterns like "style_h1"
        const titlePatterns = /title|heading|chapter-title|h1|h2|\u6807\u9898|\u30BF\u30A4\u30C8\u30EB|\uC81C\uBAA9/i;

        let h1 = doc.querySelector("h1");
        if (h1) return h1;

        let candidates = [];
        // Added p to the selector
        let headers = doc.querySelectorAll("h2, h3, div, span, strong, p");
        for (let node of headers) {
            let text = node.textContent.trim();

            // Added length restriction: titles should not be empty and shouldn't be too long
            if (text.length === 0 || text.length > 100) continue;

            let className = node.className || "";
            let id = node.id || "";
            let attrString = `${className} ${id}`;

            if (titlePatterns.test(attrString)) {
                candidates.push(node);
            }
        }

        if (candidates.length > 0) return candidates[0];
        return null;
    }

    /**
     * Generates a CSS selector string (`#id`, `.class1.class2`, or tag name) for a given DOM element.
     *
     * @param {Element} node - The DOM element to generate a selector for.
     * @returns {string} The generated CSS selector.
     */
    static generateSelector(node) {
        if (node.id) {
            return `#${CSS.escape(node.id)}`;
        }
        if (node.className && typeof node.className === "string") {
            let classes = node.className.trim().split(/\s+/).filter(c => c).map(c => CSS.escape(c));
            if (classes.length > 0) {
                return `.${classes.join(".")}`;
            }
        }
        return node.tagName.toLowerCase();
    }
}
