
"use strict";


/** Functions specific to Firefox version of plug-in */
class Firefox { // eslint-disable-line no-unused-vars
    /**
     * Constructs a Firefox helper instance.
     */
    constructor() {
    }

    /**
     * Stores active declarativeNetRequest-style header modification rules for Firefox webRequest interception.
     *
     * @param {Array<Object>} rules - Rule definitions containing actions and conditions.
     * @returns {void}
     */
    static setModifyHeaderRules(rules) {
        Firefox.activeRules = Array.isArray(rules) ? rules : [];
    }

    /**
     * Inspects outgoing Firefox HTTP headers, removes moz-extension origin headers to avoid CORS blocks,
     * and applies any active declarative header modification rules.
     *
     * @param {{url: string, requestHeaders: Array<{name: string, value?: string}>}} e - webRequest onBeforeSendHeaders event payload.
     * @returns {{requestHeaders: Array<{name: string, value?: string}>}} Modified request headers.
     */
    static filterHeaders(e) {
        let headers = e.requestHeaders.filter(
            h => ((h.name.toLowerCase() !== "origin")
                || !(h.value && h.value.startsWith("moz-extension://")))
        );
        if (Firefox.activeRules && (Firefox.activeRules.length > 0) && e?.url) {
            for (let rule of Firefox.activeRules) {
                let matches = true;
                if (rule.condition?.urlFilter) {
                    matches = e.url.includes(rule.condition.urlFilter);
                }
                if (matches && Array.isArray(rule.action?.requestHeaders)) {
                    for (let rh of rule.action.requestHeaders) {
                        let targetHeader = rh.header.toLowerCase();
                        if (rh.operation === "remove") {
                            headers = headers.filter(h => h.name.toLowerCase() !== targetHeader);
                        } else if (rh.operation === "set") {
                            let found = false;
                            for (let h of headers) {
                                if (h.name.toLowerCase() === targetHeader) {
                                    h.value = rh.value;
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) {
                                headers.push({ name: rh.header, value: rh.value });
                            }
                        }
                    }
                }
            }
        }
        return { requestHeaders: headers };
    }

    static startWebRequestListeners() {
        browser.webRequest.onBeforeSendHeaders.addListener(
            Firefox.filterHeaders,
            {urls: ["<all_urls>"]},
            ["blocking", "requestHeaders"]
        );
    }

    static injectContentScript(tabId) {
        if ((browser.scripting !== undefined)
            && (browser.scripting.executeScript !== undefined)) {
            browser.scripting.executeScript({
                target: { tabId: tabId },
                files: ["js/ContentScript.js"],
            }).then(() => {
                util.log("ContentScript injected successfully into Firefox tab, waiting for message...");
            }).catch(err => util.log("Firefox script injection error: " + err.message));
            return;
        }

        browser.tabs.executeScript(tabId, {
            file: "js/ContentScript.js",
        }).then(() => {
            util.log("ContentScript injected successfully into Firefox tab via tabs API, waiting for message...");
        }).catch(err => util.log("Firefox script injection error: " + err.message));
    }
}

Firefox.activeRules = [];

