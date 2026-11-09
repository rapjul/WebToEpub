
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
        assert.equal(handler.count, 1, "performs one initial automatic retry");
        assert.equal(handler.prompted, true, "prompts the user once the retry queue drains");
        window.userPreferences = previousPrefs;
        done();
    });
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
