
"use strict";

module("HttpClient");

const realWrapFetchImpl = HttpClient.wrapFetchImpl;

QUnit.test("charsetFromHeaders", function (assert) {
    let evaluate = (val) => {
        let mockHeader = { get: () => val };
        return new FetchResponseHandler().charsetFromHeaders(mockHeader);
    };

    assert.equal(evaluate(null), "utf-8");
    assert.equal(evaluate("text/html"), "utf-8");
    assert.equal(evaluate("text/html; charset=utf-16"), "utf-16");
    assert.equal(evaluate("text/html; Charset=utf-17"), "utf-17");
    assert.equal(evaluate("text/html; Charset=\"utf-18\""), "utf-18");
    assert.equal(evaluate("text/html;Charset=\"utf-19\";something="), "utf-19");
    assert.equal(evaluate("text/html; Charset=utf-20 ;something="), "utf-20");
});

function createDummyFetchErrorHandler(response) {
    let handler = new FetchErrorHandler();
    handler.count = 0;
    handler.prompted = false;
    handler.retryFetch = function(url, wrapOptions) {
        ++handler.count;
        wrapOptions.retry.retryDelay.pop();
        return handler.onResponseError(url, wrapOptions, response);
    }
    handler.promptUserForRetry = function(url, wrapOptions, response, failError) {
        handler.prompted = true;
        return Promise.reject();
    }
    return {errorHandler: handler};
}

function testOnResponseError(assert, status, retries, prompted) {
    let done = assert.async();
    let response = {status: status}
    let wrapOptions = createDummyFetchErrorHandler(response);
    let handler = wrapOptions.errorHandler;
    return handler.onResponseError(null, wrapOptions, response)
        .catch(function() {
            assert.equal(handler.count, retries)
            assert.equal(handler.prompted, prompted)
            done();
        });
}

QUnit.test("onResponseError_404_error_fails_immediately", function (assert) {
    testOnResponseError(assert, 404, 0, false);
});

QUnit.test("onResponseError_500_error_retries_4_times", function (assert) {
    testOnResponseError(assert, 500, 4, false);
});

QUnit.test("onResponseError_504_error_retries_4_times", function (assert) {
    testOnResponseError(assert, 504, 4, true);
});

QUnit.test("onResponseError_403_error_auto_retries_when_enabled", function (assert) {
    let done = assert.async();
    let prevPrefs = window.userPreferences;
    window.userPreferences = {
        autoRetryOn403: {value: true},
        autoRetryOn403Delay: {value: "2"}
    };
    let response = {status: 403};
    let wrapOptions = createDummyFetchErrorHandler(response);
    let handler = wrapOptions.errorHandler;
    handler.onResponseError(null, wrapOptions, response).catch(function() {
        assert.equal(handler.count, 1);
        assert.equal(handler.prompted, false);
        window.userPreferences = prevPrefs;
        done();
    });
});

QUnit.test("onResponseError_403_keep_retrying_retries_without_prompting", function (assert) {
    let done = assert.async();
    let response = {status: 403};
    let wrapOptions = createDummyFetchErrorHandler(response);
    wrapOptions.retry = {
        keepRetrying: true,
        retryDelay: [0]
    };
    let handler = wrapOptions.errorHandler;
    handler.retryFetch = function(url, retryWrapOptions) {
        ++handler.count;
        assert.equal(retryWrapOptions.retry.keepRetrying, true);
        return Promise.reject(new Error("stop"));
    };
    handler.onResponseError(null, wrapOptions, response).catch(function() {
        assert.equal(handler.count, 1);
        assert.equal(handler.prompted, false);
        done();
    });
});

QUnit.test("onResponseError_403_prompts_user_when_auto_retry_disabled", function (assert) {
    let done = assert.async();
    let previousPrefs = window.userPreferences;
    window.userPreferences = {
        autoRetryOn403: {value: false}
    };
    let response = {status: 403, url: "https://www.royalroad.com/fiction/159064/chapter/3191775"};
    let wrapOptions = createDummyFetchErrorHandler(response);
    let handler = wrapOptions.errorHandler;
    handler.onResponseError(response.url, wrapOptions, response).catch(function() {
        assert.equal(handler.count, 4, "performs progressive backoff retries before prompting");
        assert.equal(handler.prompted, true, "prompts the user once the retry queue drains");
        window.userPreferences = previousPrefs;
        done();
    });
});

QUnit.test("getUserPreferences_resolves_from_parser_or_main_or_global", function (assert) {
    let parserPrefs = { id: "parser" };
    let mainPrefs = { id: "main" };
    let globalPrefs = { id: "global" };

    let wrapOptionsWithParser = { parser: { userPreferences: parserPrefs } };
    assert.equal(FetchErrorHandler.getUserPreferences(wrapOptionsWithParser), parserPrefs, "resolves from parser options");

    let prevMain = window.main;
    let prevGlobal = window.userPreferences;
    window.main = { getUserPreferences: () => mainPrefs };
    delete window.userPreferences;
    assert.equal(FetchErrorHandler.getUserPreferences({}), mainPrefs, "resolves from main.getUserPreferences");

    delete window.main;
    window.userPreferences = globalPrefs;
    assert.equal(FetchErrorHandler.getUserPreferences({}), globalPrefs, "resolves from global userPreferences");

    window.main = prevMain;
    window.userPreferences = prevGlobal;
});

QUnit.test("promptUserForRetry_retryAction_resets_retry_object", function (assert) {
    let handler = new FetchErrorHandler();
    let wrapOptions = {
        retry: { HTTP: 403, retryDelay: [] },
        retryCount: 4
    };
    let response = { status: 403, url: "https://www.royalroad.com/fiction/159064/chapter/1" };
    let failError = new Error("failed");
    let showedMessage = null;
    let prevShowErrorMessage = ErrorLog.showErrorMessage;
    ErrorLog.showErrorMessage = (msg) => { showedMessage = msg; };

    handler.promptUserForRetry(response.url, wrapOptions, response, failError);
    assert.ok(showedMessage != null, "displayed error prompt message");
    assert.equal(typeof showedMessage.retryAction, "function", "attached retryAction handler");

    showedMessage.retryAction();
    assert.equal(wrapOptions.retryCount, 0, "reset retryCount on retry action");
    assert.equal(wrapOptions.retry, undefined, "reset retry state so fresh retries can be scheduled");

    ErrorLog.showErrorMessage = prevShowErrorMessage;
});

QUnit.test("keepRetrying_continues_past_five_retries", function (assert) {
    let done = assert.async();
    let response = { status: 403, url: "https://www.royalroad.com/fiction/159064/chapter/1" };
    let wrapOptions = createDummyFetchErrorHandler(response);
    wrapOptions.retryCount = 6;
    wrapOptions.retry = {
        keepRetrying: true,
        retryDelay: [0]
    };
    let handler = wrapOptions.errorHandler;
    handler.retryFetch = function(url, retryWrapOptions) {
        assert.equal(retryWrapOptions.retry.keepRetrying, true, "kept retrying despite retryCount > 5");
        return Promise.reject(new Error("stop"));
    };
    handler.onResponseError(response.url, wrapOptions, response).catch(function() {
        assert.equal(handler.prompted, false, "did not prompt or fail fast when keepRetrying was active");
        done();
    });
});

QUnit.test("Firefox_filterHeaders_applies_active_rules", function (assert) {
    let prevRules = Firefox.activeRules;
    Firefox.setModifyHeaderRules([
        {
            id: 1,
            action: {
                type: "modifyHeaders",
                requestHeaders: [
                    { header: "referer", operation: "set", value: "https://www.royalroad.com/fiction/159064" },
                    { header: "origin", operation: "remove" }
                ]
            },
            condition: {
                urlFilter: "royalroad.com"
            }
        }
    ]);

    let event = {
        url: "https://www.royalroad.com/fiction/159064/chapter/1",
        requestHeaders: [
            { name: "Origin", value: "moz-extension://dummy-id" },
            { name: "User-Agent", value: "TestAgent" }
        ]
    };
    let filtered = Firefox.filterHeaders(event);
    let names = filtered.requestHeaders.map(h => h.name.toLowerCase());
    let referer = filtered.requestHeaders.find(h => h.name.toLowerCase() === "referer");

    assert.ok(!names.includes("origin"), "origin header is removed");
    assert.equal(referer?.value, "https://www.royalroad.com/fiction/159064", "referer header is set from rule");

    Firefox.setModifyHeaderRules(prevRules);
});

QUnit.test("wrapFetchImpl_403_rejection_does_not_recursively_wrap_error_message", function (assert) {
    let done = assert.async();
    let previousWrapFetchImpl = HttpClient.wrapFetchImpl;
    let previousFetch = window.fetch;
    let previousSleep = util.sleep;
    let previousPrefs = window.userPreferences;
    let testUrl = "https://www.royalroad.com/fiction/159064/chapter/3191775";

    HttpClient.wrapFetchImpl = realWrapFetchImpl;
    window.userPreferences = {
        autoRetryOn403: {value: true},
        autoRetryOn403Delay: {value: "0"}
    };
    util.sleep = () => Promise.resolve();
    window.fetch = () => Promise.resolve({
        ok: false,
        status: 403,
        url: testUrl
    });

    let errorHandler = new FetchErrorHandler();
    errorHandler.makeFailMessage = (url, error) => `Fetch of URL '${url}' failed with network error ${error}.`;
    let wrapOptions = {
        errorHandler: errorHandler,
        responseHandler: new FetchTextResponseHandler()
    };

    let cleanup = () => {
        HttpClient.wrapFetchImpl = previousWrapFetchImpl;
        window.fetch = previousFetch;
        util.sleep = previousSleep;
        window.userPreferences = previousPrefs;
        done();
    };

    HttpClient.wrapFetchImpl(testUrl, wrapOptions).then(function() {
        assert.ok(false, "expected wrapFetchImpl to reject on HTTP 403");
        cleanup();
    }).catch(function(error) {
        let occurrences = (error.message.match(/failed with network error/g) || []).length;
        assert.equal(occurrences, 1, "error message is formatted once without recursive wrapping");
        assert.equal(error.status, 403, "HTTP 403 status is preserved on the rejected error");
        cleanup();
    });
});

QUnit.test("Firefox filterHeaders ignores tab requests to prevent breaking tab challenges", function (assert) {
    let prevRules = Firefox.activeRules;
    Firefox.setModifyHeaderRules([
        {
            action: {
                requestHeaders: [
                    { header: "referer", operation: "set", value: "https://www.royalroad.com/fiction/159064" },
                    { header: "origin", operation: "remove" }
                ]
            },
            condition: {
                urlFilter: "royalroad.com"
            }
        }
    ]);

    let tabEvent = {
        tabId: 5,
        originUrl: "https://www.royalroad.com/fiction/159064",
        documentUrl: "https://www.royalroad.com/fiction/159064",
        url: "https://www.royalroad.com/cdn-cgi/challenge-platform/h/b/flow/ov1/check",
        requestHeaders: [
            { name: "Origin", value: "https://www.royalroad.com" },
            { name: "User-Agent", value: "TestBrowser" }
        ]
    };
    let tabFiltered = Firefox.filterHeaders(tabEvent);
    assert.equal(tabFiltered.requestHeaders.length, 2, "tab request headers are untouched");
    let originHeader = tabFiltered.requestHeaders.find(h => h.name.toLowerCase() === "origin");
    let refererHeader = tabFiltered.requestHeaders.find(h => h.name.toLowerCase() === "referer");
    assert.equal(originHeader?.value, "https://www.royalroad.com", "tab origin is not stripped");
    assert.equal(refererHeader, undefined, "tab referer is not overridden by declarative rule");

    Firefox.setModifyHeaderRules(prevRules);
});

QUnit.test("HttpClient isClearanceCookie and unsetPartitionCookies preserve Cloudflare tokens", async function (assert) {
    assert.ok(HttpClient.isClearanceCookie("cf_clearance"), "identifies cf_clearance");
    assert.ok(HttpClient.isClearanceCookie("__cf_bm"), "identifies __cf_bm");
    assert.ok(HttpClient.isClearanceCookie("_cfuvid"), "identifies _cfuvid");
    assert.ok(HttpClient.isClearanceCookie("custom_clearance_token"), "identifies clearance in name");
    assert.notOk(HttpClient.isClearanceCookie("session_id"), "does not flag normal session cookie");

    let prevCookies = window.chrome?.cookies;
    let removed = [];
    let setCookies = [];
    let fakeCookiesApi = {
        getAll: async () => [
            { name: "cf_clearance", domain: ".royalroad.com", path: "/", partitionKey: { topLevelSite: "https://royalroad.com" }, storeId: "0" },
            { name: "__cf_bm", domain: ".royalroad.com", path: "/", partitionKey: { topLevelSite: "https://royalroad.com" }, storeId: "0" },
            { name: "temp_partitioned", domain: ".royalroad.com", path: "/", partitionKey: { topLevelSite: "https://royalroad.com" }, storeId: "0" }
        ],
        remove: async (details) => {
            removed.push(details.name);
        },
        set: async (details) => {
            setCookies.push(details.name);
        }
    };
    if (!window.chrome) {
        window.chrome = {};
    }
    window.chrome.cookies = fakeCookiesApi;

    await HttpClient.setPartitionCookies("https://www.royalroad.com/fiction/159064");
    assert.deepEqual(setCookies, ["temp_partitioned"], "setPartitionCookies skips copying clearance cookies");

    await HttpClient.unsetPartitionCookies("https://www.royalroad.com/fiction/159064");
    assert.deepEqual(removed, ["temp_partitioned"], "only non-clearance partitioned cookie is removed");

    window.chrome.cookies = prevCookies;
});

QUnit.test("showTransientRateLimitWarning deduplicates identical messages and prefixes timestamp", function (assert) {
    let container = document.getElementById("rateLimitToastContainer");
    if (container) {
        container.remove();
    }
    FetchErrorHandler.showTransientRateLimitWarning("Warning message 1", 5000);
    FetchErrorHandler.showTransientRateLimitWarning("Warning message 1", 5000);
    FetchErrorHandler.showTransientRateLimitWarning("Warning message 2", 5000);

    let activeContainer = document.getElementById("rateLimitToastContainer");
    assert.ok(activeContainer != null, "container created");
    assert.equal(activeContainer.children.length, 2, "duplicate message ignored; exactly 2 toasts created");
    assert.ok(/^\[\d{1,2}:\d{2}:\d{2}/.test(activeContainer.children[0].textContent), "toast has timestamp prefix");

    activeContainer.remove();
});

QUnit.test("getAutomaticRetryBehaviourForStatus returns undefined toastMessage for default 403 backoff", function (assert) {
    let prevPrefs = window.userPreferences;
    window.userPreferences = { autoRetryOn403: { value: false } };
    let response = { status: 403, url: "https://www.royalroad.com/fiction/159064" };
    let wrapOptions = { storyUrl: "https://www.royalroad.com/fiction/159064" };
    let behaviour = FetchErrorHandler.getAutomaticRetryBehaviourForStatus(response, wrapOptions);

    assert.equal(behaviour.HTTP, 403, "status is 403");
    assert.equal(behaviour.promptUser, true, "promptUser is true after retries");
    assert.deepEqual(behaviour.retryDelay, [60, 30, 15, 5], "standard backoff delays present");
    assert.equal(behaviour.toastMessage, undefined, "toastMessage is undefined to prevent spamming giant toast during retries");

    let challengeHeaders = new Headers();
    challengeHeaders.set("cf-mitigated", "challenge");
    let challengeResponse = { status: 403, url: "https://www.royalroad.com/fiction/159064", headers: challengeHeaders };
    let challengeBehaviour = FetchErrorHandler.getAutomaticRetryBehaviourForStatus(challengeResponse, wrapOptions);
    assert.equal(challengeBehaviour.promptUser, true, "challenge response prompts immediately");
    assert.deepEqual(challengeBehaviour.retryDelay, [], "challenge response does not schedule backoff retry loops");

    window.userPreferences = prevPrefs;
});

QUnit.test("onResponseError prompts immediately when challenge has empty retryDelay and promptUser is true", function (assert) {
    let handler = new FetchErrorHandler();
    let prompted = false;
    handler.promptUserForRetry = function (url, wrapOptions, response, failError) {
        prompted = true;
        return Promise.resolve("prompted");
    };

    let challengeHeaders = new Headers();
    challengeHeaders.set("cf-mitigated", "challenge");
    let response = {
        status: 403,
        url: "https://www.royalroad.com/fiction/182375/slug",
        headers: challengeHeaders
    };
    let wrapOptions = {};

    return handler.onResponseError(response.url, wrapOptions, response).then(result => {
        assert.equal(prompted, true, "prompted user immediately without scheduling retries");
        assert.equal(result, "prompted", "resolved prompt action");
        assert.equal(wrapOptions.retry?.HTTP, 403, "attached retry state to wrapOptions");
    });
});
