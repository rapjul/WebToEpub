"use strict";

parserFactory.register("patreon.com", () => new PatreonParser());

class PatreonParser extends Parser {
    /**
     * Initializes a new instance of PatreonParser.
     */
    constructor() {
        super();
    }

    /**
     * Extracts chapter URLs and metadata from Patreon DOM.
     *
     * @param {Document} dom - The parsed page DOM.
     * @returns {Promise<Array<{ title: string, sourceUrl: string }>>} List of chapter metadata.
     */
    async getChapterUrls(dom) {
        if (this.isCollectionList(dom)) {
            return this.getCollectionLinks(dom);
        }
        const cards = [...dom.querySelectorAll("div[data-tag='post-card']")];
        return cards
            .filter(c => this.hasAccessibleContent(c))
            .map(s => this.cardToChapter(s)).reverse();
    }

    /**
     * Extracts post links and titles from a Patreon collection page.
     *
     * @param {Document} dom - The collection page DOM.
     * @returns {Array<{ title: string, sourceUrl: string }>} List of collection chapter metadata.
     */
    getCollectionLinks(dom) {
        const getTitle = (e) => {
            return [...e.querySelectorAll("span.LineClamp-module__N_eOMG__lineClamp1")]
                .map(s => s.textContent.trim())
                .join(" ");
        };

        if (this.isCondensedView(dom)) {
            const getLink = (e) => {
                return e.querySelector("a");
            };
            // The SVG check skips all locked chapters.
            const linksContainer = [...dom.querySelectorAll("div.ListPost-module__d2AM5a__listPost:not(:has(svg[data-tag='IconLock']))")];
            return linksContainer.map(linkContainer => {
                return {
                    sourceUrl: getLink(linkContainer).href,
                    title: getTitle(linkContainer),
                };
            });
        }

        // The SVG check skips all locked chapters.
        const links = [...dom.querySelectorAll("a.CollectionPostList-module__IhO0fW__gridCard:not(:has(svg[data-tag='IconLock']))")];
        return links.map(link => ({
            sourceUrl: link.href,
            title: getTitle(link),
        }));
    }

    /**
     * Converts a post card element into a chapter metadata object.
     *
     * @param {HTMLElement} card - The card DOM element.
     * @returns {{ title: string, sourceUrl: string }} Chapter metadata.
     */
    cardToChapter(card) {
        const title = card.querySelector("span[data-tag='post-title']").textContent;
        const link = this.getUrlOfContent(card);
        return ({
            title: title.trim(),
            sourceUrl: link.href
        });
    }

    /**
     * Checks if the post card has accessible content with a valid URL.
     *
     * @param {HTMLElement} card - The card DOM element.
     * @returns {boolean} True if accessible content URL is present.
     */
    hasAccessibleContent(card) {
        const link = this.getUrlOfContent(card);
        return !util.isNullOrEmpty(link?.getAttribute("href"));
    }

    /**
     * Finds the link element pointing to post content inside a card.
     *
     * @param {HTMLElement} card - The card DOM element.
     * @returns {HTMLAnchorElement|null} The content link element.
     */
    getUrlOfContent(card) {
        return card.querySelector("a[data-tag='post-published-at']");
    }

    /**
     * Extracts constructed chapter content from a page DOM.
     *
     * @param {Document} dom - The chapter page DOM.
     * @returns {HTMLElement|null} The content element.
     */
    findContent(dom) {
        return Parser.findConstrutedContent(dom);
    }

    /**
     * Fetches a chapter's document structure and converts it to HTML.
     * Checks for server-rendered post content first before falling back
     * to Next.js bootstrap payload.
     *
     * @param {string} url - Target chapter URL to fetch.
     * @returns {Promise<{ dom: Document, content: HTMLElement }>} The constructed chapter document.
     */
    async fetchChapter(url) {
        const xhr = await HttpClient.wrapFetch(url);
        const postContent = xhr.responseXML.querySelector("div.patreon-post-content");
        if (postContent !== null) {
            return this.jsonToHtml({
                title: xhr.responseXML.querySelector("h1[data-tag='post-title']").textContent,
                content: postContent.innerHTML
            }, url);
        }
        const script = xhr.responseXML.querySelector("script#__NEXT_DATA__").textContent;
        const json = JSON.parse(script);
        const envelope = json.props.pageProps.bootstrapEnvelope;
        const bootstrap = envelope.bootstrap || envelope.pageBootstrap;
        return this.jsonToHtml(bootstrap.post.data.attributes, url);
    }

    /**
     * Converts post JSON attributes or content HTML into a DOM document.
     *
     * @param {Object} json - The post data attributes.
     * @param {string} url - The chapter source URL.
     * @returns {Document} The generated chapter DOM document.
     */
    jsonToHtml(json, url) {
        const newDoc = Parser.makeEmptyDocForContent(url);
        const header = newDoc.dom.createElement("h1");
        header.textContent = json.title;
        newDoc.content.appendChild(header);
        if (json.image) {
            const img = new Image();
            img.src = json.image.url;
            newDoc.content.append(img);
        }
        let content;
        if (json.content) {
            content = "<div>" + json.content + "</div>";
        }
        else if (json.content_json_string) {
            const tiptapToHtml = (node) => {
                if (!node) return null;

                // 1. Handle Text Nodes (Returns a Text Node or Span)
                if (node.type === "text") {
                    let root;
                    if (node.marks) {
                        // If there are marks, we build them nested
                        root = document.createElement("span");
                        let current = root;
                        node.marks.forEach(mark => {
                            let wrapper;
                            switch (mark.type) {
                                case "bold":
                                    wrapper = document.createElement("strong");
                                    break;
                                case "italic":
                                    wrapper = document.createElement("em");
                                    break;
                                case "underline":
                                    wrapper = document.createElement("u");
                                    break;
                                case "link":
                                    wrapper = document.createElement("a");
                                    wrapper.href = mark.attrs.href;
                                    wrapper.target = mark.attrs.target;
                                    break;
                                default:
                                    wrapper = document.createElement("span");
                                    console.error(`Unsupported mark type: "${mark.type}"`);
                            }
                            current.appendChild(wrapper);
                            current = wrapper;
                        });
                        current.textContent = node.text; // Safety here
                        return root;
                    } else {
                        // No marks? Just return a plain text node
                        return document.createTextNode(node.text);
                    }
                }

                // 2. Handle Block Types
                let element;
                switch (node.type) {
                    case "doc":
                        element = document.createElement("div");
                        element.className = "content-body";
                        break;

                    case "paragraph":
                        element = document.createElement("p");
                        if (node.attrs?.nodeTextAlignment) {
                            element.style.textAlign = node.attrs.nodeTextAlignment;
                        }
                        break;

                    case "heading":
                        element = document.createElement(`h${node.attrs.level || 3}`);
                        break;

                    case "bulletList":
                        element = document.createElement("ul");
                        break;

                    case "orderedList":
                        element = document.createElement("ol");
                        break;

                    case "listItem":
                        element = document.createElement("li");
                        break;

                    case "image":
                        element = document.createElement("img");
                        element.src = node.attrs.src;
                        element.alt = node.attrs.alt || "";
                        return element; // Images don't have children

                    case "blockquote":
                        element = document.createElement("blockquote");
                        break;

                    case "codeBlock": {
                        const pre = document.createElement("pre");
                        element = document.createElement("code");
                        pre.appendChild(element);

                        if (node.content) {
                            node.content.forEach(childNode => {
                                const child = tiptapToHtml(childNode);
                                if (child) element.appendChild(child);
                            });
                        }
                        return pre;
                    }
                    case "hardBreak":
                        return document.createElement("br");

                    default:
                        element = document.createElement("span");
                        break;
                }

                // 3. Recursive Step: Append children as actual DOM Nodes
                if (node.content) {
                    node.content.forEach(childNode => {
                        const childElement = tiptapToHtml(childNode);
                        if (childElement) {
                            element.appendChild(childElement);
                        }
                    });
                } else if (node.type !== "image" && node.type !== "hardBreak") {
                    // Handle empty blocks with a non-breaking space
                    element.textContent = "\u00A0";
                }

                return element;
            };
            content = tiptapToHtml(JSON.parse(json.content_json_string));
        }
        content = util.sanitize(content)
            .querySelector("div");
        newDoc.content.append(content);
        return newDoc.dom;
    }

    /**
     * Extracts the story title implementation for Patreon pages.
     *
     * @param {Document} dom - The parsed page DOM.
     * @returns {string} The formatted story title.
     */
    extractTitleImpl(dom) {
        return dom.querySelector("h1").textContent + " Patreon";
    }

    /**
     * Extracts the author name from Patreon pages.
     *
     * @param {Document} dom - The parsed page DOM.
     * @returns {string} The author name.
     */
    extractAuthor(dom) {
        if (this.isCollectionList(dom)) {
            return this.extractCollectionAuthor(dom);
        }
        const authorLabel = dom.querySelector("h1");
        return (authorLabel === null) ? super.extractAuthor(dom) : authorLabel.textContent;
    }

    /**
     * Extracts the author name from Patreon collection pages.
     *
     * @param {Document} dom - The collection page DOM.
     * @returns {string} The extracted author name.
     */
    extractCollectionAuthor(dom) {
        const title = dom.querySelector("h1");
        let parent = title.parentNode;
        while (parent.querySelector("a") === null) {
            parent = parent.parentNode;
        }
        return parent.querySelector("a")?.textContent ?? "Not Found";
    }

    /**
     * Finds the cover image URL for Patreon pages and collections.
     *
     * @param {Document} dom - The page DOM.
     * @returns {string|null} The cover image URL if found.
     */
    findCoverImageUrl(dom) {
        if (this.isCollectionList(dom)) {
            return this.extractCollectionCover(dom);
        }
        return util.getFirstImgSrc(dom, "picture");
    }

    /**
     * Extracts the collection cover image URL.
     *
     * @param {Document} dom - The collection page DOM.
     * @returns {string|null} The cover image URL if found.
     */
    extractCollectionCover(dom) {
        const divsWithPictures = dom.querySelectorAll("div[src]");
        if (divsWithPictures.length === 0) {
            return null;
        }
        return divsWithPictures[divsWithPictures.length - 1].getAttribute("src");
    }

    /**
     * Checks if the given DOM represents a Patreon collection list.
     *
     * @param {Document} dom - The page DOM.
     * @returns {boolean} True if the page is a collection list.
     */
    isCollectionList(dom) {
        return new URL(dom.baseURI).pathname.startsWith("/collection/");
    }

    /**
     * Checks if the collection page is using the condensed list view.
     *
     * @param {Document} dom - The collection page DOM.
     * @returns {boolean} True if in condensed view mode.
     */
    isCondensedView(dom) {
        const url = new URL(dom.baseURI);
        return url.searchParams.get("view") === "condensed";
    }
}
