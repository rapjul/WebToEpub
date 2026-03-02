/*
  Javascript that is injected into active tab.
  Returns the DOM of the window's contents
*/
"use strict";

try {
    // Get the full HTML using a more reliable method than document.all
    let htmlContent;

    // Try multiple fallback approaches
    if (document.documentElement && document.documentElement.outerHTML) {
        // Standard approach - get root element
        htmlContent = document.documentElement.outerHTML;
    } else if (document.all && document.all[0]) {
        // Fallback for older browsers
        htmlContent = document.all[0].outerHTML;
    } else {
        // Last resort - reconstruct from innerHTML on html element
        if (document.documentElement && document.documentElement.innerHTML) {
            htmlContent = "<html>" + document.documentElement.innerHTML + "</html>";
        } else {
            throw new Error("Unable to access document DOM through any method");
        }
    }

    // Log to console (visible in DevTools)
    console.log("[WebToEpub] ContentScript: Capturing DOM from " + document.URL);
    console.log("[WebToEpub] ContentScript: HTML length: " + htmlContent.length + " bytes");
    console.log("[WebToEpub] ContentScript: Sending message to popup");

    const parseResults = {
        messageType: "ParseResults",
        document: htmlContent,
        url: document.URL
    };

    chrome.runtime.sendMessage(parseResults, (response) => {
        if (chrome.runtime.lastError) {
            console.error("[WebToEpub] ContentScript: Error sending message: " + chrome.runtime.lastError.message);
        } else {
            console.log("[WebToEpub] ContentScript: Message sent successfully, response: " + JSON.stringify(response));
        }
    });
} catch (err) {
    console.error("[WebToEpub] ContentScript Error: " + (err ? err.toString() : "Unknown error"));
    if (chrome.runtime && chrome.runtime.sendMessage) {
        try {
            chrome.runtime.sendMessage({
                messageType: "ParseError",
                error: err.toString()
            });
        } catch (e) {
            console.error("[WebToEpub] Failed to send error message: " + e.toString());
        }
    }
}
