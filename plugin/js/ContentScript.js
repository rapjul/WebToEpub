/*
  Javascript that is injected into active tab.
  Returns the DOM of the window's contents
*/
"use strict";

try {
  var pageHtml = document.documentElement?.outerHTML ?? "";
  var parseResults = {
    messageType: "ParseResults",
    document: pageHtml,
    url: document.URL
  };
  chrome.runtime.sendMessage(parseResults);
} catch (error) {
  chrome.runtime.sendMessage({
    messageType: "ParseResults",
    document: "",
    url: document.URL,
    contentScriptError: error?.message ?? String(error)
  });
}
