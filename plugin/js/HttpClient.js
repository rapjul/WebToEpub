/*
  Makes HTML calls using Fetch API
*/
"use strict";

class FetchErrorHandler {
    constructor() {
    }

    makeFailMessage(url, error) {
        return UIText.Error.htmlFetchFailed(url, error);
    }

    makeFailCanRetryMessage(url, error) {
        return this.makeFailMessage(url, error) + " " +
            UIText.Warning.httpFetchCanRetry;
    }

    getCancelButtonText() {
        return UIText.Common.cancel;
    }

    static cancelButtonText() {
        return UIText.Common.cancel;
    }

    onFetchError(url, error) {
        return Promise.reject(new Error(this.makeFailMessage(url, error.message)));
    }

    /**
     * Safely extracts the hostname from the first valid URL candidate.
     *
     * @param {...(string|null|undefined)} candidates - Candidate URL strings to parse.
     * @returns {string} The parsed hostname, or `"unknown"` if no valid URL is provided.
     */
    static getHostname(...candidates) {
        for (const candidate of candidates) {
            if (!util.isNullOrEmpty(candidate)) {
                try {
                    return new URL(candidate).hostname;
                } catch {
                    // try next candidate
                }
            }
        }
        return "unknown";
    }

    /**
     * Resolves the active user preferences instance from wrapOptions, main, or global scope.
     *
     * @param {Object} [wrapOptions] - Optional fetch wrapper options containing a parser reference.
     * @returns {UserPreferences|null} The resolved user preferences, or null if unavailable.
     */
    static getUserPreferences(wrapOptions) {
        if (wrapOptions?.parser?.userPreferences) {
            return wrapOptions.parser.userPreferences;
        }
        if ((typeof main !== "undefined") && (typeof main.getUserPreferences === "function")) {
            let prefs = main.getUserPreferences();
            if (prefs) {
                return prefs;
            }
        }
        if ((typeof userPreferences !== "undefined") && (userPreferences !== null)) {
            return userPreferences;
        }
        if ((typeof window !== "undefined") && window.userPreferences) {
            return window.userPreferences;
        }
        return null;
    }

    /**
     * Handles non-OK HTTP responses by scheduling automatic retries, prompting the user,
     * or rejecting with a formatted status error.
     *
     * @param {string} url - The originally requested URL.
     * @param {Object} wrapOptions - Fetch wrapper options and retry state.
     * @param {Response|{status: number, url?: string, retryDelay?: number[]}} response - The HTTP response object.
     * @param {string} [errorMessage] - Optional custom error message override.
     * @returns {Promise<*>} Resolves with a retried fetch result or rejects on terminal failure.
     */
    onResponseError(url, wrapOptions, response, errorMessage) {
        let failError;
        let targetUrl = response?.url || url;
        if (errorMessage) {
            failError = new Error(errorMessage);
        } else {
            failError = new Error(this.makeFailMessage(targetUrl, response.status));
        }
        // keep HTTP status visible for caller logic (403, etc.)
        failError.status = response.status;
        failError.url = targetUrl;

        // Track and enforce a hard limit of 5 retries when not in keepRetrying mode
        if (!wrapOptions.retry?.keepRetrying) {
            wrapOptions.retryCount = (wrapOptions.retryCount || 0) + 1;
            if (wrapOptions.retryCount > 5) {
                if (wrapOptions.retry?.promptUser) {
                    return this.promptUserForRetry(url, wrapOptions, response, failError);
                }
                return Promise.reject(failError);
            }
        }

        let keepRetrying = wrapOptions.retry?.keepRetrying;
        if (wrapOptions.retry === undefined) {
            let retry = FetchErrorHandler.getAutomaticRetryBehaviourForStatus(response, wrapOptions);
            if (retry.retryDelay.length === 0) {
                if (retry.promptUser) {
                    wrapOptions.retry = retry;
                    return this.promptUserForRetry(url, wrapOptions, response, failError);
                }
                return Promise.reject(failError);
            }
            wrapOptions.retry = retry;
            return this.retryFetch(url, wrapOptions);
        }

        if (keepRetrying && response.status === 403) {
            let retry = FetchErrorHandler.getAutomaticRetryBehaviourForStatus(response, wrapOptions);
            retry.keepRetrying = true;
            wrapOptions.retry = retry;
            return this.retryFetch(url, wrapOptions);
        }

        if (0 < wrapOptions.retry.retryDelay.length) {
            return this.retryFetch(url, wrapOptions);
        }

        if (wrapOptions.retry.promptUser) {
            return this.promptUserForRetry(url, wrapOptions, response, failError);
        } else {
            return Promise.reject(failError);
        }
    }

    /**
     * Prompts the user with retry, keep-retrying, open-URL, or cancel actions when automatic retries are exhausted.
     *
     * @param {string} url - The originally requested URL.
     * @param {Object} wrapOptions - Fetch wrapper options and retry state.
     * @param {Response|{status: number, url?: string}} response - The HTTP response object.
     * @param {Error} failError - The terminal error to reject with if the user cancels.
     * @returns {Promise<*>} Resolves if the user retries and succeeds, or rejects if cancelled.
     */
    promptUserForRetry(url, wrapOptions, response, failError) {
        let msg;
        let userPreferences = FetchErrorHandler.getUserPreferences(wrapOptions);
        let host = FetchErrorHandler.getHostname(response?.url, url);
        if (wrapOptions.retry.HTTP === 403) {
            if (userPreferences?.noContentToError403?.value) {
                msg = new Error(UIText.Warning.warningNoContentTo403ErrorResponse(host) + this.makeFailCanRetryMessage(url, response.status));
            } else {
                msg = new Error(UIText.Warning.warning403ErrorResponse(host) + this.makeFailCanRetryMessage(url, response.status));
            }
        } else {
            msg = new Error(new Error(this.makeFailCanRetryMessage(url, response.status)));
        }
        let cancelLabel = this.getCancelButtonText();
        return new Promise((resolve, reject) => {
            if (wrapOptions.retry.HTTP === 403) {
                msg.openurl = response?.url || url;
                msg.blockurl = url;
                msg.keepRetryingAction = () => {
                    wrapOptions.retryCount = 0;
                    wrapOptions.retry.keepRetrying = true;
                    resolve(HttpClient.wrapFetchImpl(url, wrapOptions));
                };
            }
            msg.retryAction = () => {
                wrapOptions.retryCount = 0;
                wrapOptions.retry = undefined;
                resolve(HttpClient.wrapFetchImpl(url, wrapOptions));
            };
            msg.cancelAction = () => reject(failError);
            msg.cancelLabel = cancelLabel;
            ErrorLog.showErrorMessage(msg);
        });
    }

    /**
     * Waits for the next scheduled delay in `wrapOptions.retry.retryDelay` and re-invokes `HttpClient.wrapFetchImpl`.
     *
     * @param {string} url - The URL to retry fetching.
     * @param {Object} wrapOptions - Fetch wrapper options containing retry delay state.
     * @returns {Promise<*>} The result of the retried fetch call.
     */
    async retryFetch(url, wrapOptions) {
        let delaySeconds = wrapOptions.retry.retryDelay.pop();
        if (wrapOptions.retry?.toastMessage) {
            FetchErrorHandler.showTransientRateLimitWarning(wrapOptions.retry.toastMessage, 5000);
        }
        if (wrapOptions.retry?.HTTP === 403 && !util.isNullOrEmpty(wrapOptions.storyUrl)) {
            FetchErrorHandler.scheduleStalled403Warning(
                wrapOptions.storyUrl,
                wrapOptions.retry.toastHost,
                wrapOptions.retry.stallWarningMessage
            );
        }
        let delayBeforeRetry = delaySeconds * 1000;
        await util.sleep(delayBeforeRetry);
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    /**
     * Determines the automatic retry delays and user-prompting behavior for a given HTTP response status.
     *
     * @param {Response|{status: number, url?: string, retryDelay?: number[]}} response - The HTTP response object.
     * @param {Object} [wrapOptions] - Optional fetch wrapper options containing `storyUrl`.
     * @returns {{retryDelay: number[], promptUser: boolean, HTTP?: number, toastHost?: string, stallWarningMessage?: string, toastMessage?: string}} Retry configuration object.
     */
    static getAutomaticRetryBehaviourForStatus(response, wrapOptions) {
        // seconds to wait before each retry (note: order is reversed)
        let retryDelay = [120, 60, 30, 15];
        switch (response.status) {
            case 403: {
                let isChallenge = false;
                if (typeof response?.headers?.get === "function") {
                    let cfMitigated = response.headers.get("cf-mitigated");
                    if (cfMitigated === "challenge") {
                        isChallenge = true;
                    }
                }
                let userPreferences = FetchErrorHandler.getUserPreferences(wrapOptions);
                let autoRetry = userPreferences?.autoRetryOn403?.value;
                let delaySeconds = 5;
                let storyUrl = wrapOptions?.storyUrl;
                let host = FetchErrorHandler.getHostname(response?.url, storyUrl);
                if (isChallenge) {
                    console.warn(`[WebToEpub][HttpClient] Cloudflare challenge detected (cf-mitigated: challenge) on ${response?.url || host}`);
                    return {
                        retryDelay: [],
                        promptUser: true,
                        HTTP: 403,
                        toastHost: host,
                        stallWarningMessage: UIText.Warning.warning403StalledRetry(host),
                        toastMessage: undefined
                    };
                }
                let autoIncrease = userPreferences?.autoIncreaseDelayOn403?.value;
                if (autoIncrease && !util.isNullOrEmpty(storyUrl) && (typeof Parser !== "undefined") && (Parser.additionalDelayByStory != null)) {
                    let increment = parseInt(userPreferences?.autoIncreaseDelayOn403Amount?.value, 10);
                    if (isNaN(increment) || increment < 0) {
                        increment = 1000;
                    }
                    let previous = Parser.additionalDelayByStory.get(storyUrl) || 0;
                    let updated = previous + increment;
                    Parser.additionalDelayByStory.set(storyUrl, updated);
                    delaySeconds = Math.max(5, Math.ceil(updated / 1000));
                    return {
                        retryDelay: [delaySeconds * 3, delaySeconds * 2, delaySeconds],
                        promptUser: !autoRetry,
                        HTTP: 403,
                        toastHost: host,
                        stallWarningMessage: UIText.Warning.warning403StalledRetry(host),
                        toastMessage: UIText.Warning.warning403AutoIncreaseDelayToast(host, updated, delaySeconds)
                    };
                } else if (autoRetry) {
                    let configured = parseInt(userPreferences?.autoRetryOn403Delay?.value, 10);
                    if (!isNaN(configured) && configured >= 0) {
                        delaySeconds = configured;
                    }
                    return {
                        retryDelay: [delaySeconds],
                        promptUser: false,
                        HTTP: 403,
                        toastHost: host,
                        stallWarningMessage: UIText.Warning.warning403StalledRetry(host),
                        toastMessage: UIText.Warning.warning403AutoRetryToast(host, delaySeconds)
                    };
                }
                return {
                    retryDelay: [60, 30, 15, 5],
                    promptUser: true,
                    HTTP: 403,
                    toastHost: host,
                    stallWarningMessage: UIText.Warning.warning403StalledRetry(host),
                    toastMessage: undefined
                };
            }
            case 429:
                FetchErrorHandler.show429Error(response);
                return {retryDelay: retryDelay, promptUser: true};
            case 445:
            //Random Unique exception thrown on Webnovel/Qidian. Not part of w3 spec.
                return {retryDelay: retryDelay, promptUser: false};
            case 509:
            // server asked for rate limiting
                return {retryDelay: retryDelay, promptUser: true};
            case 500:
            // is fault at server, retry might clear
                return {retryDelay: retryDelay, promptUser: false};
            case 502:
            case 503:
            case 504:
            case 520:
            case 522:
            // intermittant fault
                return {retryDelay: retryDelay, promptUser: true};
            case 524:
            // claudflare random error
                return {retryDelay: [1], promptUser: true};
            case 999:
            // custom WebToEpub error (some api's fail and a few seconds later it is a success)
                return {retryDelay: response.retryDelay, promptUser: false};
            default:
            // it's dead Jim
                return {retryDelay: [], promptUser: false};
        }
    }

    static show429Error(response) {
        let host = new URL(response.url).hostname;
        if (!FetchErrorHandler.rateLimitedHosts.has(host)) {
            FetchErrorHandler.rateLimitedHosts.add(host);
            FetchErrorHandler.showTransientRateLimitWarning(
                UIText.Warning.warning429ErrorResponse(host),
                5000
            );
        }
    }

    static showTransientRateLimitWarning(message, timeoutMs) {
        if (!document?.body) {
            console.warn("Unable to show rate limit warning: document not ready");
            return;
        }
        let containerId = "rateLimitToastContainer";
        let container = document.getElementById(containerId);
        if (container) {
            for (let child of container.children) {
                if (child.dataset?.toastMessage === message) {
                    return;
                }
            }
        } else {
            container = document.createElement("div");
            container.id = containerId;
            container.style.position = "fixed";
            container.style.bottom = "20px";
            container.style.right = "20px";
            container.style.zIndex = "9999";
            container.style.display = "flex";
            container.style.flexDirection = "column";
            container.style.gap = "8px";
            container.style.maxWidth = "360px";
            container.style.pointerEvents = "none";
            document.body.appendChild(container);
        }

        let toast = document.createElement("div");
        toast.dataset.toastMessage = message;
        toast.style.background = "rgba(30, 30, 30, 0.9)";
        toast.style.color = "#ffffff";
        toast.style.padding = "12px 16px";
        toast.style.borderRadius = "6px";
        toast.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
        toast.style.fontSize = "14px";
        toast.style.lineHeight = "1.3";
        toast.style.pointerEvents = "auto";
        toast.style.border = "1px solid rgba(255,255,255,0.2)";
        toast.style.display = "flex";
        toast.style.alignItems = "center";
        toast.style.gap = "12px";

        let timestamp = new Date().toLocaleTimeString();
        let formattedMessage = `[${timestamp}] ${message}`;

        let messageNode = document.createElement("span");
        messageNode.textContent = formattedMessage;
        messageNode.style.flex = "1";

        let closeButton = document.createElement("button");
        closeButton.textContent = "×";
        closeButton.style.background = "transparent";
        closeButton.style.color = "#ffffff";
        closeButton.style.border = "none";
        closeButton.style.fontSize = "16px";
        closeButton.style.cursor = "pointer";
        closeButton.style.padding = "0";
        closeButton.style.lineHeight = "1";

        toast.appendChild(messageNode);
        toast.appendChild(closeButton);
        container.appendChild(toast);

        let timeoutId;
        let removeToast = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            toast.remove();
            if (container.childElementCount === 0) {
                container.remove();
            }
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };

        let startDismissTimer = () => {
            let stickyToasts = FetchErrorHandler.getUserPreferences()?.toastMessagesRequireDismiss?.value;
            if (stickyToasts) {
                return;
            }
            if (timeoutId) {
                return;
            }
            timeoutId = setTimeout(removeToast, timeoutMs ?? 5000);
        };

        let onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                startDismissTimer();
                document.removeEventListener("visibilitychange", onVisibilityChange);
            }
        };

        if (document.visibilityState === "visible") {
            startDismissTimer();
        } else {
            document.addEventListener("visibilitychange", onVisibilityChange);
        }

        closeButton.addEventListener("click", removeToast);
    }

    static scheduleStalled403Warning(storyUrl, host, message) {
        if (util.isNullOrEmpty(storyUrl) || util.isNullOrEmpty(host) || util.isNullOrEmpty(message)) {
            return;
        }
        if (FetchErrorHandler.stalledStoryWarnings.has(storyUrl)) {
            return;
        }
        let timeoutId = setTimeout(() => {
            FetchErrorHandler.stalledStoryWarnings.delete(storyUrl);
            FetchErrorHandler.showTransientRateLimitWarning(message, 10000);
        }, 60000);
        FetchErrorHandler.stalledStoryWarnings.set(storyUrl, timeoutId);
    }

    static clearStalled403Warning(storyUrl) {
        if (util.isNullOrEmpty(storyUrl)) {
            return;
        }
        let timeoutId = FetchErrorHandler.stalledStoryWarnings.get(storyUrl);
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            FetchErrorHandler.stalledStoryWarnings.delete(storyUrl);
        }
    }

    static showTransientRateLimitWarningWithDismiss(message, timeoutMs, storageKey) {
        if (!document?.body) {
            console.warn("Unable to show rate limit warning: document not ready");
            return;
        }
        let containerId = "rateLimitToastContainer";
        let container = document.getElementById(containerId);
        if (container) {
            for (let child of container.children) {
                if (child.dataset?.toastMessage === message) {
                    return;
                }
            }
        } else {
            container = document.createElement("div");
            container.id = containerId;
            container.style.position = "fixed";
            container.style.bottom = "20px";
            container.style.right = "20px";
            container.style.zIndex = "9999";
            container.style.display = "flex";
            container.style.flexDirection = "column";
            container.style.gap = "8px";
            container.style.maxWidth = "400px";
            container.style.pointerEvents = "none";
            document.body.appendChild(container);
        }

        let toast = document.createElement("div");
        toast.dataset.toastMessage = message;
        toast.style.background = "rgba(30, 30, 30, 0.9)";
        toast.style.color = "#ffffff";
        toast.style.padding = "12px 16px";
        toast.style.borderRadius = "6px";
        toast.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
        toast.style.fontSize = "14px";
        toast.style.lineHeight = "1.4";
        toast.style.pointerEvents = "auto";
        toast.style.border = "1px solid rgba(255,255,255,0.2)";
        toast.style.display = "flex";
        toast.style.flexDirection = "column";
        toast.style.gap = "8px";

        let timestamp = new Date().toLocaleTimeString();
        let formattedMessage = `[${timestamp}] ${message}`;

        let messageNode = document.createElement("span");
        messageNode.textContent = formattedMessage;

        let buttonsContainer = document.createElement("div");
        buttonsContainer.style.display = "flex";
        buttonsContainer.style.gap = "8px";
        buttonsContainer.style.justifyContent = "flex-end";

        let dismissButton = document.createElement("button");
        dismissButton.textContent = "Don't show again";
        dismissButton.style.background = "rgba(255, 100, 100, 0.7)";
        dismissButton.style.color = "#ffffff";
        dismissButton.style.border = "none";
        dismissButton.style.borderRadius = "3px";
        dismissButton.style.padding = "6px 12px";
        dismissButton.style.cursor = "pointer";
        dismissButton.style.fontSize = "12px";
        dismissButton.style.fontWeight = "bold";

        let closeButton = document.createElement("button");
        closeButton.textContent = "Close";
        closeButton.style.background = "rgba(100, 100, 100, 0.7)";
        closeButton.style.color = "#ffffff";
        closeButton.style.border = "none";
        closeButton.style.borderRadius = "3px";
        closeButton.style.padding = "6px 12px";
        closeButton.style.cursor = "pointer";
        closeButton.style.fontSize = "12px";

        toast.appendChild(messageNode);
        buttonsContainer.appendChild(dismissButton);
        buttonsContainer.appendChild(closeButton);
        toast.appendChild(buttonsContainer);
        container.appendChild(toast);

        let timeoutId;
        let removeToast = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            toast.remove();
            if (container.childElementCount === 0) {
                container.remove();
            }
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };

        let startDismissTimer = () => {
            let stickyToasts = FetchErrorHandler.getUserPreferences()?.toastMessagesRequireDismiss?.value;
            if (stickyToasts) {
                return;
            }
            if (timeoutId) {
                return;
            }
            timeoutId = setTimeout(removeToast, timeoutMs ?? 5000);
        };

        let onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                startDismissTimer();
                document.removeEventListener("visibilitychange", onVisibilityChange);
            }
        };

        if (document.visibilityState === "visible") {
            startDismissTimer();
        } else {
            document.addEventListener("visibilitychange", onVisibilityChange);
        }

        dismissButton.addEventListener("click", () => {
            window.localStorage.setItem(storageKey, "true");
            removeToast();
        });

        closeButton.addEventListener("click", removeToast);
    }
}
FetchErrorHandler.rateLimitedHosts = new Set();
FetchErrorHandler.stalledStoryWarnings = new Map();

class FetchImageErrorHandler extends FetchErrorHandler { // eslint-disable-line no-unused-vars
    constructor(parentPageUrl) {
        super();
        this.parentPageUrl = parentPageUrl;
    }

    makeFailMessage(url, error) {
        return UIText.Error.imageFetchFailed(url, this.parentPageUrl, error);
    }

    getCancelButtonText() {
        return UIText.Common.skip;
    }
}

class HttpClient {
    constructor() {
    }

    static makeOptions() {
        return { credentials: "include" };
    }

    static wrapFetch(url, wrapOptions) {
        if (wrapOptions == null) {
            wrapOptions = {
                errorHandler: new FetchErrorHandler()
            };
        }
        if (wrapOptions.errorHandler == null) {
            wrapOptions.errorHandler = new FetchErrorHandler();
        }
        wrapOptions.responseHandler = new FetchResponseHandler();
        if (wrapOptions.makeTextDecoder != null) {
            wrapOptions.responseHandler.makeTextDecoder = wrapOptions.makeTextDecoder;
        }
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    static fetchHtml(url) {
        let wrapOptions = {
            responseHandler: new FetchHtmlResponseHandler()
        };
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    static fetchJson(url, fetchOptions) {
        let parser = fetchOptions?.parser;
        delete fetchOptions?.parser;
        let wrapOptions = {
            responseHandler: new FetchJsonResponseHandler(),
            fetchOptions: fetchOptions,
            parser: parser
        };
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    /**
     * Fetches a URL and decodes the response body as plain text.
     *
     * @param {string} url - The URL to fetch.
     * @param {Object} [fetchOptions] - Optional fetch options (may include a `parser` reference for custom error handling).
     * @returns {Promise<string>} Resolves with the decoded text content.
     */
    static fetchText(url, fetchOptions) {
        let parser = fetchOptions?.parser;
        delete fetchOptions?.parser;
        let wrapOptions = {
            responseHandler: new FetchTextResponseHandler(),
            fetchOptions: fetchOptions,
            parser: parser
        };
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    /**
     * Executes a wrapped `fetch` call with partitioned cookie synchronization, blocked-site checks,
     * and response error/retry handling.
     *
     * @param {string} url - The URL to fetch.
     * @param {Object} wrapOptions - Options containing `responseHandler`, `errorHandler`, `fetchOptions`, and optional `parser`.
     * @returns {Promise<*>} Resolves with the extracted response data or rejects on failure.
     */
    static async wrapFetchImpl(url, wrapOptions) {
        let hostname = new URL(url).hostname;
        if (HttpClient.blockedSites.has(hostname)) {
            let skipurlerror = new Error(UIText.Warning.parserDisabledNotification);
            return wrapOptions.errorHandler.onFetchError(url, skipurlerror);
        }
        if (BlockedHostNames.has(hostname)) {
            let skipurlerror = new Error("!Blocked! URL skipped because the user blocked the site");
            return wrapOptions.errorHandler.onFetchError(url, skipurlerror);
        }
        if (wrapOptions.fetchOptions == null) {
            wrapOptions.fetchOptions = HttpClient.makeOptions();
        }
        if (wrapOptions.errorHandler == null) {
            wrapOptions.errorHandler = new FetchErrorHandler();
        }
        let response;
        try
        {
            await HttpClient.setPartitionCookies(url);
            response = await fetch(url, wrapOptions.fetchOptions);
            await HttpClient.unsetPartitionCookies(url);
        }
        catch (error)
        {
            return wrapOptions.errorHandler.onFetchError(url, error);
        }
        if (!util.isNullOrEmpty(wrapOptions.storyUrl)) {
            FetchErrorHandler.clearStalled403Warning(wrapOptions.storyUrl);
        }
        let ret = await HttpClient.checkResponseAndGetData(url, wrapOptions, response);
        if (wrapOptions.parser?.isNoContentToError403AndContentNull(ret)) {
            let CustomNoContentToError403Response = wrapOptions.parser.setNoContentToError403Response(url, wrapOptions, ret);
            return wrapOptions.errorHandler.onResponseError(CustomNoContentToError403Response.url, CustomNoContentToError403Response.wrapOptions, CustomNoContentToError403Response.response, CustomNoContentToError403Response.errorMessage);
        }
        if (wrapOptions.parser?.isCustomError(ret)) {
            let CustomErrorResponse = wrapOptions.parser.setCustomErrorResponse(url, wrapOptions, ret);
            return wrapOptions.errorHandler.onResponseError(CustomErrorResponse.url, CustomErrorResponse.wrapOptions, CustomErrorResponse.response, CustomErrorResponse.errorMessage);
        }
        return ret;
    }

    /**
     * Checks whether the HTTP response succeeded and extracts its content, or delegates to `onResponseError`.
     *
     * @param {string} url - The requested URL.
     * @param {Object} wrapOptions - Fetch wrapper options.
     * @param {Response} response - The raw `fetch` response object.
     * @returns {Promise<*>} Extracted content or retry/error handler result.
     */
    static checkResponseAndGetData(url, wrapOptions, response) {
        if (!response.ok) {
            if (response.status === 403 && typeof response.headers?.get === "function") {
                let cfMitigated = response.headers.get("cf-mitigated");
                let server = response.headers.get("server");
                if (cfMitigated || (server && server.toLowerCase().includes("cloudflare"))) {
                    console.log(`[WebToEpub][HttpClient] HTTP 403 diagnostics for ${url}: cf-mitigated=${cfMitigated || "none"}, server=${server || "unknown"}`);
                }
            }
            return wrapOptions.errorHandler.onResponseError(url, wrapOptions, response);
        } else {
            let handler = wrapOptions.responseHandler;
            handler.setResponse(response);
            return handler.extractContentFromResponse(response);
        }
    }

    /**
     * Replaces active `declarativeNetRequest` session rules, scoping `initiatorDomains` to this extension.
     *
     * @param {Array<Object>} RulesArray - Array of `declarativeNetRequest` rule definitions.
     * @returns {Promise<void>} Resolves when session rules have been updated.
     */
    static async setDeclarativeNetRequestRules(RulesArray) {
        if (util.isFirefox() && (typeof Firefox !== "undefined") && (typeof Firefox.setModifyHeaderRules === "function")) {
            Firefox.setModifyHeaderRules(RulesArray);
        }
        if ((typeof chrome === "undefined") || !chrome?.runtime?.getURL || !chrome?.declarativeNetRequest?.updateSessionRules) {
            return;
        }
        if (!util.isFirefox()) {
            let url = chrome.runtime.getURL("").split("/").filter(a => a != "");
            let id = url[url.length - 1];
            for (let i = 0; i < RulesArray.length; i++) {
                //limit rule to only webtoepub domain to prevent potiential security problems
                RulesArray[i].condition.initiatorDomains = [id];
            }
        }
        let oldRules = await chrome.declarativeNetRequest.getSessionRules();
        //In firefox i had declarativeNetRequest.getSessionRules() fail with undefined
        if (oldRules == null) {
            oldRules = [];
        }
        let oldRuleIds = oldRules.map(rule => rule.id);
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: oldRuleIds,
            addRules: RulesArray
        });
    }

    /**
     * Copies partitioned cookies to the unpartitioned cookie store so that extension-initiated
     * fetch requests (which run in an unpartitioned context) can send them.
     * @param {string} url - The URL of the request to copy cookies for.
     * @returns {Promise<void>} Resolves when all partitioned cookies have been copied.
     */
    static async setPartitionCookies(url) {
        // get partitionKey in the form of https://<site name>.<tld>
        let parsedUrl = new URL(url);
        //keep old code for reference in case it changes again
        //let topLevelSite = parsedUrl.protocol + "//" + parsedUrl.hostname;

        try {
            //  get all cookie from the site which use the partitionKey (e.g. cloudflare)
            // keep old code for reference in case it changes again
            // let cookies = await chrome.cookies.getAll({partitionKey: {topLevelSite: topLevelSite}});

            // set domain to the highest level from the website as all subdomains are included #1447 #1445
            let urlparts = parsedUrl.hostname.split(".");
            let domain = urlparts[urlparts.length - 2] + "." + urlparts[urlparts.length - 1];
            let cookieApi = util.isFirefox() ? browser.cookies : chrome.cookies;
            let partitionedCookies = await cookieApi.getAll({domain: domain, partitionKey: {}});
            let unpartitionedCookies = await cookieApi.getAll({domain: domain});
            HttpClient.logCookiesForDomain(domain, partitionedCookies, unpartitionedCookies);
            let cookies = partitionedCookies.filter(item => item.partitionKey != undefined);
            for (const element of cookies) {
                if (HttpClient.isClearanceCookie(element.name)) {
                    continue;
                }
                const cleanDomain = element.domain.startsWith(".") ? element.domain.substring(1) : element.domain;
                const cookieDetails = {
                    url: `https://${cleanDomain}${element.path}`,
                    name: element.name,
                    value: element.value,
                    path: element.path,
                    secure: element.secure,
                    httpOnly: element.httpOnly,
                    sameSite: element.sameSite,
                    expirationDate: element.expirationDate,
                    storeId: element.storeId
                };
                if (!element.hostOnly && !element.name.startsWith("__Host-")) {
                    cookieDetails.domain = element.domain;
                }
                try {
                    await cookieApi.set(cookieDetails);
                } catch (cookieError) {
                    console.error(`[WebToEpub] Failed to set cookie ${element.name}:`, cookieError);
                }
            }
        } catch (err) {
            // Probably running browser that doesn't support partitionKey, e.g. Kiwi
            console.log("failed to set cookie", err);
        }
    }

    /**
     * Checks if a cookie is a Cloudflare or authentication clearance cookie that must be preserved.
     *
     * @param {string} cookieName - The name of the cookie.
     * @returns {boolean} True if the cookie should not be removed.
     */
    static isClearanceCookie(cookieName) {
        if (!cookieName) {
            return false;
        }
        let lower = cookieName.toLowerCase();
        return lower.startsWith("cf_") || lower.startsWith("__cf") || lower.includes("clearance") || lower.startsWith("_cf");
    }

    /**
     * Removes temporary unpartitioned copies of partitioned cookies after a `fetch` request completes
     * while preserving Cloudflare clearance tokens to prevent infinite challenge verification loops.
     *
     * @param {string} url - The URL of the completed request.
     * @returns {Promise<void>} Resolves when temporary unpartitioned cookies have been removed.
     */
    static async unsetPartitionCookies(url) {
        let parsedUrl = new URL(url);
        try {
            let urlparts = parsedUrl.hostname.split(".");
            let domain = urlparts[urlparts.length - 2] + "." + urlparts[urlparts.length - 1];
            let cookieApi = util.isFirefox() ? browser.cookies : chrome.cookies;
            let partitionedCookies = await cookieApi.getAll({domain: domain, partitionKey: {}});
            let cookies = partitionedCookies.filter(item => item.partitionKey != undefined);
            for (const element of cookies) {
                if (HttpClient.isClearanceCookie(element.name)) {
                    continue;
                }
                const cleanDomain = element.domain.startsWith(".") ? element.domain.substring(1) : element.domain;
                try {
                    await cookieApi.remove({
                        name: element.name,
                        url: `https://${cleanDomain}${element.path}`,
                        storeId: element.storeId
                    });
                } catch (cookieError) {
                    console.error(`[WebToEpub] Failed to unset cookie ${element.name}:`, cookieError);
                }
            }
        } catch (err) {
            // Probably running browser that doesn't support partitionKey, e.g. Kiwi
            console.log("failed to unset cookie", err);
        }
    }

    static logCookiesForDomain(domain, partitioned, unpartitioned) {
        if (HttpClient.loggedCookieDomains.has(domain)) {
            return;
        }
        HttpClient.loggedCookieDomains.add(domain);
        let fmt = (list, label) => `${label}: ` + (list?.map(c => `${c.name}=${c.value}`).join("; ") || "<none>");
        console.log(`[WebToEpub][HttpClient] cookies for ${domain}`, fmt(partitioned, "partitioned"), fmt(unpartitioned, "unpartitioned"));
    }
}

let BlockedHostNames = new Set();
HttpClient.loggedCookieDomains = new Set();
HttpClient.blockedSites = new Set();

class FetchResponseHandler {
    isHtml() {
        return this.contentType.startsWith("text/html");
    }

    setResponse(response) {
        this.response = response;
        this.contentType = response.headers.get("content-type");
    }

    extractContentFromResponse(response) {
        if (this.isHtml()) {
            return this.responseToHtml(response);
        } else {
            return this.responseToBinary(response);
        }
    }

    responseToHtml(response) {
        return response.arrayBuffer().then(function(rawBytes) {
            let data = this.makeTextDecoder(response).decode(rawBytes);
            let html = new DOMParser().parseFromString(data, "text/html");
            util.setBaseTag(this.response.url, html);
            this.responseXML = html;
            return this;
        }.bind(this));
    }

    responseToBinary(response) {
        return response.arrayBuffer().then(function(data) {
            this.arrayBuffer = data;
            return this;
        }.bind(this));
    }

    responseToText(response) {
        return response.arrayBuffer().then(function(rawBytes) {
            return this.makeTextDecoder(response).decode(rawBytes);
        }.bind(this));
    }

    responseToJson(response) {
        return response.text().then(function(data) {
            this.json =  JSON.parse(data);
            return this;
        }.bind(this));
    }

    makeTextDecoder(response) {
        let utflabel = this.charsetFromHeaders(response.headers);
        return new TextDecoder(utflabel);
    }

    charsetFromHeaders(headers) {
        let contentType = headers.get("Content-Type");
        if (!util.isNullOrEmpty(contentType)) {
            let pieces = contentType.toLowerCase().split("charset=");
            if (2 <= pieces.length) {
                return pieces[1].split(";")[0].replace(/"/g, "").trim();
            }
        }
        return FetchResponseHandler.DEFAULT_CHARSET;
    }
}
FetchResponseHandler.DEFAULT_CHARSET = "utf-8";

class FetchJsonResponseHandler extends FetchResponseHandler {
    constructor() {
        super();
    }

    extractContentFromResponse(response) {
        return super.responseToJson(response);
    }
}

class FetchTextResponseHandler extends FetchResponseHandler {
    constructor() {
        super();
    }

    extractContentFromResponse(response) {
        return super.responseToText(response);
    }
}

class FetchHtmlResponseHandler extends FetchResponseHandler {
    constructor() {
        super();
    }

    extractContentFromResponse(response) {
        return super.responseToHtml(response);
    }
}
