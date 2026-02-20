
"use strict";


/** Functions specific to Firefox version of plug-in */
class Firefox { // eslint-disable-line no-unused-vars
    constructor() {
    }

    /** fetch() calls on Firefox include an origin header.
        Which makes some sites fail with a CORS violation.
        Need to use a webRequest to remove origin from header.
    */
    static filterHeaders(e) {
        return {requestHeaders: e.requestHeaders.filter(
            h => ((h.name.toLowerCase() !== "origin")
                || !h.value.startsWith("moz-extension://"))
        )};
    }

    static startWebRequestListeners() {
        browser.webRequest.onBeforeSendHeaders.addListener(
            Firefox.filterHeaders,
            {urls: ["<all_urls>"]},
            ["blocking", "requestHeaders"]
        );
    }

    static injectContentScript(tabId, onError = () => {}) {
        try {
            if (chrome.scripting?.executeScript) {
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ["js/ContentScript.js"]
                }, () => {
                    if (chrome.runtime.lastError) {
                        util.log(chrome.runtime.lastError.message);
                        onError(chrome.runtime.lastError.message);
                    }
                });
                return;
            }

            if (chrome.tabs?.executeScript) {
                chrome.tabs.executeScript(tabId, { file: "js/ContentScript.js", runAt: "document_end" },
                    function(result) {   // eslint-disable-line no-unused-vars
                        if (chrome.runtime.lastError) {
                            util.log(chrome.runtime.lastError.message);
                            onError(chrome.runtime.lastError.message);
                        }
                    }
                );
                return;
            }

            onError("No available script injection API in Firefox runtime");
        } catch (error) {
            onError(error?.message ?? String(error));
        }
    }
}

