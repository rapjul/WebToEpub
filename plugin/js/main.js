/*
    Main processing handler for popup.html

*/

const APOSTROPHE_NORMALIZE_REGEX = /\u2019/g;

function normalizeApostrophes(value) {
    return (value ?? "").replace(APOSTROPHE_NORMALIZE_REGEX, "'");
}

const TitleSuffixController = (function() {
    const TITLE_SUFFIX_PATTERN = /\s*\{To [^}]*\}\s*$/i;
    const CHAPTER_KEYWORD_PATTERN = /\b(?:chapter|chap|ch|episode|ep|part)\b[^\d]{0,32}(\d+(?:\.\d+)?)/i;
    const LEADING_NUMBER_PATTERN = /^[-\u2013\u2014\s]*(\d+(?:\.\d+)?)/;
    const GENERIC_NUMBER_PATTERN = /\d+(?:\.\d+)?/;
    const MAX_KEYWORD_OFFSET = 64;
    const MAX_GENERIC_NUMBER_OFFSET = 24;
    const COLLECTION_KEYWORD_PATTERN = /\b(book|volume|vol|arc|bk)\b[^0-9ivxlcdm]{0,24}(\d+(?:\.\d+)?|[ivxlcdm]+)/i;
    const ROMAN_NUMERAL_PATTERN = /^[ivxlcdm]+$/i;
    const MAX_COLLECTION_KEYWORD_OFFSET = 96;

    let baseTitle = "";
    let latestChapterLabel = null;
    let latestCollectionInfo = null;
    let selectedChapterCount = 0;
    let enabled = true;
    let fileNameMaxLength = 20;
    let lastAutoFileName = "";
    let fileNameOverride = false;
    let isSuffixAutoManaged = true;
    let lastAppliedSuffix = "";
    let useLookalikes = false;

    function init() {
        let titleInput = getTitleInput();
        if (titleInput) {
            titleInput.addEventListener("input", onTitleInput);
            titleInput.addEventListener("blur", onTitleBlur);
        }
        let fileNameInput = getFileNameInput();
        if (fileNameInput) {
            fileNameInput.addEventListener("blur", onFileNameBlur);
            fileNameInput.dataset.userOverride = fileNameInput.dataset.userOverride ?? "false";
        }
    }

    function getTitleInput() {
        return document.getElementById("titleInput");
    }

    function getFileNameInput() {
        return document.getElementById("fileNameInput");
    }

    function onTitleInput() {
        handleTitleInput(false);
    }

    function onTitleBlur() {
        handleTitleInput(true);
    }

    function handleTitleInput(reapplySuffix) {
        let titleInput = getTitleInput();
        if (!titleInput) {
            return;
        }
        let value = normalizeApostrophes(titleInput.value ?? "");
        if (titleInput.value !== value) {
            titleInput.value = value;
        }
        if (updateBaseTitleFromRenderedValue(value)) {
            updateFileName();
        }
        if (reapplySuffix) {
            updateTitleField();
        }
    }

    function updateBaseTitleFromRenderedValue(value) {
        let extractedBase = extractBaseFromRenderedValue(value);
        if (extractedBase !== baseTitle) {
            baseTitle = extractedBase;
            return true;
        }
        return false;
    }

    function extractBaseFromRenderedValue(value) {
        return stripManagedSuffix(normalizeApostrophes(value ?? ""));
    }

    function stripManagedSuffix(value) {
        let trimmed = value.toString().trimEnd();
        let firstMatchedSuffix = null;
        while (TITLE_SUFFIX_PATTERN.test(trimmed)) {
            let match = trimmed.match(TITLE_SUFFIX_PATTERN);
            if (!match) {
                break;
            }
            if (!firstMatchedSuffix) {
                firstMatchedSuffix = match[0];
            }
            let matchStart = (typeof match.index === "number") ? match.index : (trimmed.length - match[0].length);
            trimmed = trimmed.slice(0, matchStart).trimEnd();
        }
        if (firstMatchedSuffix) {
            evaluateSuffixOwnership(firstMatchedSuffix);
        } else {
            isSuffixAutoManaged = true;
        }
        return trimmed;
    }

    function evaluateSuffixOwnership(rawSuffix) {
        let normalizedMatch = normalizeSuffixText(rawSuffix);
        if (normalizedMatch === "") {
            isSuffixAutoManaged = true;
            return;
        }
        let normalizedLastApplied = normalizeSuffixText(lastAppliedSuffix);
        if (normalizedMatch === normalizedLastApplied && normalizedLastApplied !== "") {
            isSuffixAutoManaged = true;
            return;
        }
        let normalizedCurrent = normalizeSuffixText(buildSuffix());
        if (normalizedMatch === normalizedCurrent && normalizedCurrent !== "") {
            isSuffixAutoManaged = true;
            return;
        }
        isSuffixAutoManaged = false;
    }

    function normalizeSuffixText(value) {
        if (util.isNullOrEmpty(value)) {
            return "";
        }
        return value.replace(/\s+/g, " ").trim().toUpperCase();
    }

    function onFileNameBlur() {
        let fileNameInput = getFileNameInput();
        if (!fileNameInput) {
            return;
        }
        fileNameOverride = (fileNameInput.value !== lastAutoFileName);
        fileNameInput.dataset.userOverride = fileNameOverride ? "true" : "false";
    }

    /**
     * Builds a formatted suffix describing the current collection and chapter selection.
     *
     * - Returns an empty string when suffix generation is disabled or no chapters are selected.
     * - Includes the latest collection label and number when available.
     * - Appends the latest chapter label, or a count of selected chapters if no label exists.
     *
     * @returns {string} Formatted suffix string or an empty string when not applicable.
     */
    function buildSuffix() {
        if (!enabled || (selectedChapterCount <= 0)) {
            return "";
        }
        let suffixParts = [];
        if (latestCollectionInfo?.number) {
            suffixParts.push(`${latestCollectionInfo.label} ${latestCollectionInfo.number}`);
        }
        if (!util.isNullOrEmpty(latestChapterLabel)) {
            suffixParts.push(`Ch ${latestChapterLabel}`);
        } else {
            suffixParts.push(`Ch. Count of ${selectedChapterCount}`);
        }
        return `{To ${suffixParts.join(" ")}}`;
    }

    /**
     * Updates the title input field by combining the base title with a dynamically
     * built suffix when auto-management is enabled. Safely exits if the input is not
     * found or suffix auto-management is disabled, and keeps track of the last applied
     * suffix while updating the global auto-management flag when no suffix is present.
     */
    function updateTitleField() {
        let titleInput = getTitleInput();
        if (!titleInput) {
            return;
        }
        if (!isSuffixAutoManaged) {
            return;
        }
        let suffix = buildSuffix();
        let titleValue = baseTitle ?? "";
        if (!util.isNullOrEmpty(titleValue) && suffix !== "") {
            titleValue = `${titleValue} ${suffix}`;
            lastAppliedSuffix = suffix;
        } else if (util.isNullOrEmpty(titleValue) && suffix !== "") {
            titleValue = suffix;
            lastAppliedSuffix = suffix;
        } else {
            lastAppliedSuffix = "";
        }
        if (titleInput.value !== titleValue) {
            titleInput.value = titleValue;
        }
        if (suffix === "") {
            isSuffixAutoManaged = true;
        }
    }

    /**
     * Updates the filename input with a sanitized title, unless the user has overridden it.
     *
     * It derives a safe filename from the base title (defaulting to "web") with a maximum length,
     * falls back to "web" when empty, and tracks whether the filename was auto-set or user overridden.
     *
     * @param {boolean} [force=false] - When true, updates the filename even if a user override is detected.
     */
    function updateFileName(force = false) {
        let fileNameInput = getFileNameInput();
        if (!fileNameInput) {
            return;
        }
        let rawTitle = baseTitle || "web";
        // applyPlatformLookalikes handles the per-platform character set internally:
        // Windows→all 8 chars, macOS→colon only, Linux→nothing.
        let effectiveLookalikes = useLookalikes;
        let processedTitle = effectiveLookalikes ? util.applyPlatformLookalikes(rawTitle) : rawTitle;
        let sanitized = util.safeForFileName(processedTitle, fileNameMaxLength);
        if (util.isNullOrEmpty(sanitized)) {
            sanitized = "web";
        }
        if (fileNameOverride && !force && fileNameInput.value !== sanitized) {
            return;
        }
        fileNameInput.value = sanitized;
        fileNameInput.dataset.userOverride = "false";
        lastAutoFileName = sanitized;
        fileNameOverride = false;

        // Show an inline hint listing any characters stripped/replaced during auto-sanitization
        let hintRow = document.getElementById("fileNameSanitizedRow");
        if (hintRow) {
            let hintSpan = document.getElementById("fileNameSanitizedHint");
            if (effectiveLookalikes) {
                // Show chars that were substituted with their lookalike replacement
                let unique = [...new Set([...rawTitle].filter(c => util.applyPlatformLookalikes(c) !== c))];
                if (unique.length > 0) {
                    hintSpan.textContent = `Replaced in filename: ${unique.map(c => `${c}\u2192${util.applyPlatformLookalikes(c)}`).join("  ")}`;
                    hintRow.hidden = false;
                } else {
                    hintRow.hidden = true;
                }
            } else {
                // Mirror the keep-set from safeForFileName (spaces/nbsp→_, slash→+ are transforms, not strips)
                // Non-ASCII Unicode (≥ U+0080) is also preserved now, matching the updated regex
                let stripped = [...new Set([...rawTitle].filter(c =>
                    c !== " " && c !== "\u00a0" && c !== "/" &&
                    !/[a-z0-9_'"\-\+\&\(\)\[\]\{\}!\u0080-\uffff]/i.test(c)
                ))];
                if (stripped.length > 0) {
                    hintSpan.textContent = `Removed from filename: ${stripped.join(" ")}`;
                    hintRow.hidden = false;
                } else {
                    hintRow.hidden = true;
                }
            }
        }
    }

    /**
     * Derives a chapter label from a title string by normalizing whitespace,
     * validating against known "chapter" keywords and number patterns, and
     * returning the matched label or number when appropriate.
     *
     * Rules:
     * - Null, empty, or whitespace-only titles return `null`.
     * - Titles ending with a number but lacking a preceding chapter keyword
     *   return `null`.
     * - Prefers explicit chapter keywords near the start; otherwise tries
     *   leading numbers, then generic numbers within allowed offsets.
     *
     * @param {string} title - The raw title text to inspect.
     * @returns {string|null} The extracted chapter label/number, or `null` if none is found.
     */
    function extractChapterLabel(title) {
        if (util.isNullOrEmpty(title)) {
            return null;
        }
        let normalized = title.replace(/\s+/g, " ").trim();
        if (normalized === "") {
            return null;
        }

        // If the title ends with a number but the preceding words are not a Chapter variant, fall back to total count.
        let trailingNumberMatch = normalized.match(/^(.*?)(\d+(?:\.\d+)?)\s*$/);
        if (trailingNumberMatch) {
            let beforeNumber = trailingNumberMatch[1].replace(/[:\-\u2013\u2014]+\s*$/, "").trim();
            if (beforeNumber !== "") {
                let chapterVariantAtEnd = /(\b(?:ch\.?,?|chap(?:ter)?|chapter)\b)$/i;
                if (!chapterVariantAtEnd.test(beforeNumber)) {
                    return null;
                }
            }
        }

        let keywordMatch = normalized.match(CHAPTER_KEYWORD_PATTERN);
        if (keywordMatch && keywordMatch.index <= MAX_KEYWORD_OFFSET) {
            return keywordMatch[1];
        }
        let leadingMatch = normalized.match(LEADING_NUMBER_PATTERN);
        if (leadingMatch) {
            return leadingMatch[1];
        }
        let genericMatch = normalized.match(GENERIC_NUMBER_PATTERN);
        if (genericMatch && genericMatch.index <= MAX_GENERIC_NUMBER_OFFSET) {
            return genericMatch[0];
        }
        return null;
    }

    /**
     * Extracts collection metadata from a title string.
     *
     * @param {string} title - The raw title to inspect for collection information.
     * @returns {{label: string, number: string} | null} An object containing the normalized collection label and number, or null if no valid collection info is found.
     */
    function extractCollectionInfo(title) {
        if (util.isNullOrEmpty(title)) {
            return null;
        }
        let normalized = title.replace(/\s+/g, " ").trim();
        if (normalized === "") {
            return null;
        }
        let match = normalized.match(COLLECTION_KEYWORD_PATTERN);
        if (!match) {
            return null;
        }
        if (typeof match.index === "number" && match.index > MAX_COLLECTION_KEYWORD_OFFSET) {
            return null;
        }
        let label = normalizeCollectionLabel(match[1]);
        let normalizedNumber = normalizeCollectionNumber(match[2]);
        if (!normalizedNumber) {
            return null;
        }
        if (!hasValidCollectionSeparator(normalized, match)) {
            return null;
        }
        return {
            label: label,
            number: normalizedNumber
        };
    }

    /**
     * Determines whether the separator between a detected collection keyword and a following number is valid.
     *
     * A separator is considered valid if it contains non-whitespace characters, if the number is not a Roman numeral,
     * or if any character immediately after a Roman numeral is non-word or the end of the string.
     *
     * @param {string} normalizedTitle - The normalized title string to inspect.
     * @param {RegExpMatchArray} match - Regex match object where `match[1]` is the collection keyword and `match[2]` is the number.
     * @returns {boolean} True if the separator is valid; otherwise, false.
     */
    function hasValidCollectionSeparator(normalizedTitle, match) {
        let keywordEnd = match.index + match[1].length;
        let numberStart = normalizedTitle.indexOf(match[2], keywordEnd);
        if (numberStart === -1) {
            return false;
        }
        let separator = normalizedTitle.slice(keywordEnd, numberStart);
        if (separator.trim() !== "") {
            return true;
        }
        if (!ROMAN_NUMERAL_PATTERN.test(match[2])) {
            return true;
        }
        let afterNumberIndex = numberStart + match[2].length;
        let charAfterNumber = normalizedTitle.charAt(afterNumberIndex);
        if (charAfterNumber === "") {
            return true;
        }
        return !(/\w/.test(charAfterNumber));
    }

    /**
     * Normalizes a collection label keyword to a standardized form.
     *
     * @param {string} [keyword] - The input keyword to normalize.
     * @returns {string} The normalized collection label ("Vol", "Arc", or "Book").
     */
    function normalizeCollectionLabel(keyword) {
        switch ((keyword ?? "").toLowerCase()) {
            case "vol":
            case "volume":
                return "Vol";
            case "arc":
                return "Arc";
            default:
                return "Book";
        }
    }

    /**
     * Normalizes a collection number into a numeric string.
     *
     * Accepts numeric strings, numbers, or Roman numerals; trims whitespace,
     * validates decimal formats, and converts Roman numerals to their numeric
     * representation. Returns `null` for null/empty input or invalid formats.
     *
     * @param {string|number|null|undefined} rawValue - The raw collection number to normalize.
     * @returns {string|null} A normalized numeric string, or `null` if the input is invalid.
     */
    function normalizeCollectionNumber(rawValue) {
        if (util.isNullOrEmpty(rawValue)) {
            return null;
        }
        let trimmed = rawValue.toString().trim();
        if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
            return trimmed;
        }
        if (ROMAN_NUMERAL_PATTERN.test(trimmed)) {
            let numeric = parseRomanNumeral(trimmed);
            if (numeric != null) {
                return numeric.toString();
            }
        }
        return null;
    }

    /**
     * Parses a Roman numeral string and returns its integer value.
     *
     * Converts the input to uppercase, validates Roman numeral characters,
     * and applies subtractive notation rules (e.g., IV = 4). Returns `null`
     * for empty input, invalid characters, or non-positive results.
     *
     * @param {string} value - The Roman numeral string to parse.
     * @returns {number|null} The parsed integer value, or `null` if invalid.
     */
    function parseRomanNumeral(value) {
        let roman = (value ?? "").toUpperCase();
        if (roman === "") {
            return null;
        }
        const numerals = {
            "I": 1,
            "V": 5,
            "X": 10,
            "L": 50,
            "C": 100,
            "D": 500,
            "M": 1000
        };
        let total = 0;
        let previous = 0;
        for (let i = roman.length - 1; i >= 0; i--) {
            let currentValue = numerals[roman[i]];
            if (!currentValue) {
                return null;
            }
            if (currentValue < previous) {
                total -= currentValue;
            } else {
                total += currentValue;
                previous = currentValue;
            }
        }
        return (total > 0) ? total : null;
    }

    return {
        init,
        onUserPreferencesUpdate(preferences) {
            useLookalikes = preferences?.useUnicodeLookalikes?.value === true;
            enabled = preferences?.appendLatestChapterInfo?.value !== false;
            fileNameMaxLength = preferences?.useFullTitle?.value ? 512 : 20;
            updateFileName();
            updateTitleField();
        },
        setBaseTitle(title) {
            baseTitle = normalizeApostrophes(title ?? "");
            isSuffixAutoManaged = true;
            lastAppliedSuffix = "";
            updateFileName(true);
            updateTitleField();
        },
        setInitialFileName(fileName) {
            lastAutoFileName = fileName ?? "";
            let input = getFileNameInput();
            if (input) {
                input.value = lastAutoFileName;
                input.dataset.userOverride = "false";
                fileNameOverride = false;
            }
        },
        onChapterSelectionChanged(lastChapterTitle, chapterCount) {
            let normalizedCount = Number(chapterCount);
            if (!Number.isFinite(normalizedCount)) {
                normalizedCount = 0;
            }
            selectedChapterCount = Math.max(0, Math.floor(normalizedCount));
            latestChapterLabel = extractChapterLabel(lastChapterTitle);
            latestCollectionInfo = extractCollectionInfo(lastChapterTitle);

            updateTitleField();
        }
    };
})();

window.TitleSuffixController = TitleSuffixController;

var main = (function() {
    "use strict";

    // this will be called when message listener fires
    function onMessageListener(message, sender, sendResponse) {  // eslint-disable-line no-unused-vars
        if (message.messageType == "ParseResults") {
            chrome.runtime.onMessage.removeListener(onMessageListener);
            util.log("addListener");
            util.log(message);
            // convert the string returned from content script back into a DOM
            let dom = new DOMParser().parseFromString(message.document, "text/html");
            populateControlsWithDom(message.url, dom);
        }
    }

    // details
    let initialWebPage = null;
    let parser = null;
    let userPreferences = null;
    let library = new Library;

    // register listener that is invoked when script injected into HTML sends its results
    function addMessageListener() {
        try {
            // note, this will throw if not running as an extension.
            if (!chrome.runtime.onMessage.hasListener(onMessageListener)) {
                chrome.runtime.onMessage.addListener(onMessageListener);
            }
        } catch (chromeError) {
            util.log(chromeError);
        }
    }

    // extract urls from DOM and populate control
    async function processInitialHtml(url, dom) {
        if (setParser(url, dom)) {
            try {
                userPreferences.addObserver(parser);
            } catch (error) {
                ErrorLog.showErrorMessage(error);
                return;
            }
            try {
                await parser.loadEpubMetaInfo(dom);
                let metaInfo = parser.getEpubMetaInfo(dom, userPreferences.useFullTitle.value);
                populateMetaInfo(metaInfo);
                setUiToDefaultState();
                parser.populateUI(dom);
            } catch (error) {
                ErrorLog.showErrorMessage(error);
            }
            try {
                await parser.onLoadFirstPage(url, dom);
            } catch (error) {
                ErrorLog.showErrorMessage(error);
            }
        }
    }

    function setUiToDefaultState() {
        document.getElementById("highestResolutionImagesRow").hidden = true;
        document.getElementById("unSuperScriptAlternateTranslations").hidden = true;
        document.getElementById("imageSection").hidden = true;
        document.getElementById("outputSection").hidden = false;
        document.getElementById("translatorRow").hidden = true;
        document.getElementById("fileAuthorAsRow").hidden = true;
        document.getElementById("defaultParserSection").hidden = true;
    }

    function populateMetaInfo(metaInfo) {
        setUiFieldToValue("startingUrlInput", metaInfo.uuid);
        const normalizedTitle = normalizeApostrophes(metaInfo.title);
        setUiFieldToValue("titleInput", normalizedTitle);
        TitleSuffixController.setBaseTitle(normalizedTitle);
        setUiFieldToValue("authorInput", metaInfo.author);
        setUiFieldToValue("languageInput", metaInfo.language);
        setUiFieldToValue("fileNameInput", metaInfo.fileName);
        TitleSuffixController.setInitialFileName(metaInfo.fileName);
        setUiFieldToValue("subjectInput", metaInfo.subject);
        setUiFieldToValue("descriptionInput", metaInfo.description);
        if (metaInfo.seriesName !== null) {
            document.getElementById("seriesRow").hidden = false;
            document.getElementById("volumeRow").hidden = false;
            setUiFieldToValue("seriesNameInput", metaInfo.seriesName);
            setUiFieldToValue("seriesIndexInput", metaInfo.seriesIndex);
        }

        setUiFieldToValue("translatorInput", metaInfo.translator);
        setUiFieldToValue("fileAuthorAsInput", metaInfo.fileAuthorAs);
    }

    function setUiFieldToValue(elementId, value) {
        let element = document.getElementById(elementId);
        if (util.isTextInputField(element) || util.isTextAreaField(element)) {
            element.value = (value == null) ? "" : value;
        } else {
            throw new Error(UIText.Error.unhandledFieldTypeError);
        }
    }

    function metaInfoFromControls() {
        let metaInfo = new EpubMetaInfo();
        metaInfo.uuid = getValueFromUiField("startingUrlInput");
        metaInfo.title = getValueFromUiField("titleInput");
        metaInfo.author = getValueFromUiField("authorInput");
        metaInfo.language = getValueFromUiField("languageInput");
        metaInfo.fileName = getValueFromUiField("fileNameInput");
        metaInfo.subject = getValueFromUiField("subjectInput");
        metaInfo.description = getValueFromUiField("descriptionInput");

        if (document.getElementById("seriesRow").hidden === false) {
            metaInfo.seriesName = getValueFromUiField("seriesNameInput");
            metaInfo.seriesIndex = getValueFromUiField("seriesIndexInput");
        }

        metaInfo.translator = getValueFromUiField("translatorInput");
        metaInfo.fileAuthorAs = getValueFromUiField("fileAuthorAsInput");
        metaInfo.styleSheet = userPreferences.styleSheet.value;

        return metaInfo;
    }

    function getValueFromUiField(elementId) {
        let element = document.getElementById(elementId);
        if (util.isTextInputField(element) || util.isTextAreaField(element)) {
            return (element.value === "") ? null : element.value;
        } else {
            throw new Error(UIText.Error.unhandledFieldTypeError);
        }
    }

    async function fetchContentAndPackEpub() {
        let libclick = this;
        if (document.getElementById("noAdditionalMetadataCheckbox").checked == true) {
            setUiFieldToValue("subjectInput", "");
            setUiFieldToValue("descriptionInput", "");
        }
        let metaInfo = metaInfoFromControls();

        if ("yes" == libclick.dataset.libclick) {
            if (document.getElementById("chaptersPageInChapterListCheckbox").checked) {
                ErrorLog.showErrorMessage(UIText.Error.errorAddToLibraryLibraryAddPageWithChapters);
                return;
            }
        }

        ChapterUrlsUI.limitNumOfChapterS(userPreferences.maxChaptersPerEpub.value);
        ChapterUrlsUI.resetDownloadStateImages();
        ErrorLog.clearHistory();
        window.workInProgress = true;
        main.getPackEpubButton().disabled = true;
        replaceLibAddToLibrary();
        parser.onStartCollecting();
        await parser.fetchContent();
        let content;
        try {
            content = await packEpub(metaInfo);
        } catch (err) {
            window.workInProgress = false;
            main.getPackEpubButton().disabled = false;
            replaceLibAddToLibrary();
            ErrorLog.showErrorMessage(err);
            return;
        }
        // Enable button here.  If user cancels save dialog
        // the promise never returns
        window.workInProgress = false;
        main.getPackEpubButton().disabled = false;
        replaceLibAddToLibrary();
        let overwriteExisting = userPreferences.overwriteExistingEpub.value;
        let backgroundDownload = userPreferences.noDownloadPopup.value;
        try {
            let fileName = Download.CustomFilename();
            if ("yes" == libclick.dataset.libclick || util.sleepController.signal.aborted) {
                await library.LibAddToLibrary(content, fileName, document.getElementById("startingUrlInput").value, overwriteExisting, backgroundDownload);
            } else {
                await Download.save(content, fileName, overwriteExisting, backgroundDownload);
            }
        } catch (err) {
            ErrorLog.showErrorMessage(err);
        }
        try {
            parser.updateReadingList();
            if (util.sleepController.signal.aborted) {
                util.sleepController = new AbortController;
                resetUI();
            }
            if (libclick.dataset.libsuppressErrorLog == true) {
                return;
            } else {
                ErrorLog.showLogToUser();
                dumpErrorLogToFile();
            }
        } catch (err) {
            window.workInProgress = false;
            main.getPackEpubButton().disabled = false;
            if (util.sleepController.signal.aborted) {
                util.sleepController = new AbortController;
            }
            replaceLibAddToLibrary();
            ErrorLog.showErrorMessage(err);
        }
    }

    function replaceLibAddToLibrary() {
        let el = document.getElementById("LibAddToLibrary");
        el.hidden = !el.hidden;
        el = document.getElementById("LibPauseToLibrary");
        el.hidden = !el.hidden;
    }

    function pauseToLibrary() {
        util.sleepController.abort();
    }

    function epubVersionFromPreferences() {
        return userPreferences.createEpub3.value ?
            EpubPacker.EPUB_VERSION_3 : EpubPacker.EPUB_VERSION_2;
    }

    function packEpub(metaInfo) {
        let epubVersion = epubVersionFromPreferences();
        let epub = new EpubPacker(metaInfo, epubVersion);
        return epub.assemble(parser.epubItemSupplier());
    }

    function dumpErrorLogToFile() {
        let errors = ErrorLog.dumpHistory();
        if (userPreferences.writeErrorHistoryToFile.value &&
            !util.isNullOrEmpty(errors)) {
            let fileName = metaInfoFromControls().fileName + ".ErrorLog.txt";
            let blob = new Blob([errors], {type : "text"});
            return Download.save(blob, fileName)
                .catch (err => ErrorLog.showErrorMessage(err));
        }
    }

    function getActiveTabDOM(tabId) {
        addMessageListener();
        injectContentScript(tabId);
    }

    function injectContentScript(tabId) {
        if (util.isFirefox()) {
            Firefox.injectContentScript(tabId);
        } else {
            chromeInjectContentScript(tabId);
        }
    }

    function chromeInjectContentScript(tabId) {
        try {
            chrome.scripting.executeScript({
                target: {tabId: tabId},
                files: ["js/ContentScript.js"]
            });
        } catch {
            if (chrome.runtime.lastError) {
                util.log(chrome.runtime.lastError.message);
            }
        }
    }

    function populateControls() {
        loadUserPreferences();
        parserFactory.populateManualParserSelectionTag(getManuallySelectParserTag());
        configureForTabMode();
    }

    function loadUserPreferences() {
        userPreferences = UserPreferences.readFromLocalStorage();
        userPreferences.addObserver(library);
        userPreferences.addObserver(TitleSuffixController);
        userPreferences.writeToUi();
        userPreferences.hookupUi();
        BakaTsukiSeriesPageParser.registerBakaParsers(userPreferences.autoSelectBTSeriesPage.value);
    }

    function isRunningInTabMode() {
        // if query string supplied, we're running in Tab mode.
        let search = window.location.search;
        return !util.isNullOrEmpty(search);
    }

    async function populateControlsWithDom(url, dom) {
        initialWebPage = dom;
        setUiFieldToValue("startingUrlInput", url);

        // set the base tag, in case server did not supply it
        util.setBaseTag(url, initialWebPage);
        await processInitialHtml(url, initialWebPage);
        if (document.getElementById("autosearchmetadataCheckbox").checked == true) {
            await autosearchadditionalmetadata();
        }
    }

    function setParser(url, dom) {
        let manualSelect = getManuallySelectParserTag().value;
        if (util.isNullOrEmpty(manualSelect)) {
            parser = parserFactory.fetch(url, dom);
        } else {
            parser = parserFactory.manuallySelectParser(manualSelect);
        }
        if (parser === undefined) {
            ErrorLog.showErrorMessage(UIText.Error.noParserFound);
            return false;
        }
        getLoadAndAnalyseButton().hidden = true;
        let disabledMessage = parser.disabled();
        if (disabledMessage !== null) {
            ErrorLog.showErrorMessage(disabledMessage);
            return false;
        }
        return true;
    }

    // called when the "Diagnostics" check box is ticked or unticked
    function onDiagnosticsClick() {
        let enable = document.getElementById("diagnosticsCheckBoxInput").checked;
        document.getElementById("reloadButton").hidden = !enable;
    }

    function onAdvancedOptionsClick() {
        let section =  getAdvancedOptionsSection();
        section.hidden = !section.hidden;
        section = getAdditionalMetadataSection();
        section.hidden = !userPreferences.ShowMoreMetadataOptions.value;
        section =  getLibrarySection();
        section.hidden = true;
    }

    function onShowMoreMetadataOptionsClick() {
        let section = getAdditionalMetadataSection();
        section.hidden = !section.hidden;
    }

    function onLibraryClick() {
        let section =  getLibrarySection();
        section.hidden = !section.hidden;
        if (!section.hidden) {
            Library.LibRenderSavedEpubs();
        }
        section =  getAdvancedOptionsSection();
        section.hidden = true;
    }

    function onStylesheetToDefaultClick() {
        document.getElementById("stylesheetInput").value = EpubMetaInfo.getDefaultStyleSheet();
        userPreferences.readFromUi();
    }

    async function openTabWindow() {
        // open new tab window, passing ID of open tab with content to convert to epub as query parameter.
        let tabId = await getActiveTab();
        let url = chrome.runtime.getURL("popup.html") + "?id=";
        url += tabId;
        try {
            chrome.tabs.create({ url: url, openerTabId: tabId });
        }
        catch (err) {
            //firefox android catch
            chrome.tabs.create({ url: url});
        }
        window.close();
    }

    function getActiveTab() {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({ currentWindow: true, active: true }, (tabs) => {
                if ((tabs != null) && (0 < tabs.length)) {
                    resolve(tabs[0].id);
                } else {
                    reject();
                }
            });
        });
    }

    async function onLoadAndAnalyseButtonClick() {
        // load page via XmlHTTPRequest
        let url = getValueFromUiField("startingUrlInput");
        getLoadAndAnalyseButton().disabled = true;
        try {
            let xhr = await HttpClient.wrapFetch(url);
            await populateControlsWithDom(url, xhr.responseXML);
            getLoadAndAnalyseButton().disabled = false;
        } catch (error) {
            getLoadAndAnalyseButton().disabled = false;
            ErrorLog.showErrorMessage(error);
        }
    }

    function configureForTabMode() {
        getActiveTabDOM(extractTabIdFromQueryParameter());
    }

    function extractTabIdFromQueryParameter() {
        let windowId = window.location.search.split("=")[1];
        if (!util.isNullOrEmpty(windowId)) {
            return parseInt(windowId, 10);
        }
    }

    function getPackEpubButton() {
        return document.getElementById("packEpubButton");
    }

    function getLoadAndAnalyseButton() {
        return document.getElementById("loadAndAnalyseButton");
    }

    function resetUI() {
        initialWebPage = null;
        parser = null;
        let metaInfo = new EpubMetaInfo();
        metaInfo.uuid = "";
        populateMetaInfo(metaInfo);
        getLoadAndAnalyseButton().hidden = false;
        main.getPackEpubButton().disabled = false;
        document.getElementById("LibAddToLibrary").disabled = false;
        document.getElementById("LibAddToLibrary").hidden = false;
        document.getElementById("LibPauseToLibrary").hidden = true;
        ChapterUrlsUI.clearChapterUrlsTable();
        CoverImageUI.clearUI();
        ProgressBar.setValue(0);
        // Clear the selected value so it doesn't look like a parser is selected
        document.getElementById("manuallySelectParserTag").selectedIndex = -1;
    }

    function localizeHtmlPage() {
        // can't use a single select, because there are buttons in td elements
        for (let selector of ["button, option", "td, th", ".i18n"]) {
            for (let element of [...document.querySelectorAll(selector)]) {
                const text = element.textContent.trim();
                if (text.startsWith("__MSG_")) {
                    UIText.localizeElement(element);
                }
            }
        }
    }

    function clearCoverUrl() {
        CoverImageUI.setCoverImageUrl(null);
    }

    function getManuallySelectParserTag() {
        return document.getElementById("manuallySelectParserTag");
    }

    function getAdditionalMetadataSection() {
        return document.getElementById("AdditionalMetadatatable");
    }

    function getAdvancedOptionsSection() {
        return document.getElementById("advancedOptionsSection");
    }

    function getLibrarySection() {
        return document.getElementById("hiddenBibSection");
    }

    function onSeriesPageHelp() {
        chrome.tabs.create({ url: "https://github.com/dteviot/WebToEpub/wiki/FAQ#using-baka-tsuki-series-page-parser" });
    }

    function onCustomFilenameHelp() {
        chrome.tabs.create({ url: "https://github.com/dteviot/WebToEpub/wiki/Advanced-Options#custom-filename" });
    }

    function onDefaultParserHelp() {
        chrome.tabs.create({ url: "https://github.com/dteviot/WebToEpub/wiki/FAQ#how-to-convert-a-new-site-using-the-default-parser" });
    }

    function onReadOptionsFromFile(event) {
        userPreferences.readFromFile(event, populateControls);
    }

    function onReadingListCheckboxClicked() {
        let url = parser.state.chapterListUrl;
        let checked = UserPreferences.getReadingListCheckbox().checked;
        userPreferences.readingList.onReadingListCheckboxClicked(checked, url);
    }

    function sbFiltersShow()
    {
        sbShow();
        ChapterUrlsUI.Filters.init();
        document.getElementById("sbFilters").hidden = false;

        let filtersForm = document.getElementById("sbFiltersForm");
        util.removeElements(filtersForm.children);
        filtersForm.appendChild(ChapterUrlsUI.Filters.generateFiltersTable());
        ChapterUrlsUI.Filters.Filter(); //Run reset filters to clear confusion.
    }

    function sbShow() {
        document.getElementById("sbOptions").classList.add("sidebarOpen");
    }

    function sbHide() {
        document.getElementById("sbOptions").classList.remove("sidebarOpen");
        document.getElementById("sbFilters").hidden = true;
    }

    function showReadingList() {
        let sections = new Map(
            [...document.querySelectorAll("section")]
                .map(s =>[s, s.hidden])
        );
        [...sections.keys()].forEach(s => s.hidden = true);

        document.getElementById("readingListSection").hidden = false;
        document.getElementById("closeReadingList").onclick = () => {
            [...sections].forEach(s => s[0].hidden = s[1]);
        };

        let table = document.getElementById("readingListTable");
        userPreferences.readingList.showReadingList(table);
        table.onclick = (event) => userPreferences.readingList.onClickRemove(event);
    }

    /**
     * If work in progress, give user chance to cancel closing the window
     */
    function onUnloadEvent(event) {
        if (window.workInProgress === true) {
            event.preventDefault();
            event.returnValue = "";
        } else {
            delete event["returnValue"];
        }
    }

    function addEventHandlers() {
        getPackEpubButton().onclick = fetchContentAndPackEpub;
        document.getElementById("diagnosticsCheckBoxInput").onclick = onDiagnosticsClick;
        document.getElementById("reloadButton").onclick = populateControls;
        getManuallySelectParserTag().onchange = populateControls;
        document.getElementById("advancedOptionsButton").onclick = onAdvancedOptionsClick;
        document.getElementById("hiddenBibButton").onclick = onLibraryClick;
        document.getElementById("ShowMoreMetadataOptionsCheckbox").addEventListener("change", () => onShowMoreMetadataOptionsClick());
        document.getElementById("LibShowAdvancedOptionsCheckbox").addEventListener("change", () => Library.LibRenderSavedEpubs());
        document.getElementById("LibAddToLibrary").addEventListener("click", fetchContentAndPackEpub);
        document.getElementById("LibPauseToLibrary").addEventListener("click", pauseToLibrary);
        document.getElementById("stylesheetToDefaultButton").onclick = onStylesheetToDefaultClick;
        document.getElementById("resetButton").onclick = resetUI;
        document.getElementById("clearCoverImageUrlButton").onclick = clearCoverUrl;
        document.getElementById("seriesPageHelpButton").onclick = onSeriesPageHelp;
        document.getElementById("CustomFilenameHelpButton").onclick = onCustomFilenameHelp;
        document.getElementById("defaultParserHelpButton").onclick = onDefaultParserHelp;
        getLoadAndAnalyseButton().onclick = onLoadAndAnalyseButtonClick;
        document.getElementById("loadMetadataButton").onclick = onLoadMetadataButtonClick;

        document.getElementById("writeOptionsButton").onclick = () => userPreferences.writeToFile();
        document.getElementById("readOptionsInput").onchange = onReadOptionsFromFile;
        UserPreferences.getReadingListCheckbox().onclick = onReadingListCheckboxClicked;
        document.getElementById("viewFiltersButton").onclick = () => sbFiltersShow();
        document.getElementById("sbClose").onclick = () => sbHide();
        document.getElementById("viewReadingListButton").onclick = () => showReadingList();
        window.addEventListener("beforeunload", onUnloadEvent);
    }


    // Additional metadata
    async function autosearchadditionalmetadata() {
        getPackEpubButton().disabled = true;
        document.getElementById("LibAddToLibrary").disabled = true;
        let titlename = getValueFromUiField("titleInput");
        let url ="https://www.novelupdates.com/series-finder/?sf=1&sh="+titlename;
        if (getValueFromUiField("subjectInput")==null) {
            await autosearchnovelupdates(url, titlename);
        }
        getPackEpubButton().disabled = false;
        document.getElementById("LibAddToLibrary").disabled = false;
    }

    async function autosearchnovelupdates(url, titlename) {
        try {
            let xhr = await HttpClient.wrapFetch(url);
            await findnovelupdatesurl(url, xhr.responseXML, titlename);
        } catch (error) {
            getLoadAndAnalyseButton().disabled = false;
            ErrorLog.showErrorMessage(error);
        }
    }

    async function findnovelupdatesurl(url, dom, titlename) {
        try {
            let searchurl = [...dom.querySelectorAll("a")].filter(a => a.textContent==titlename)[0];
            setUiFieldToValue("metadataUrlInput", searchurl.href);
            url = getValueFromUiField("metadataUrlInput");
            if (url.includes("novelupdates.com") == true) {
                await onLoadMetadataButtonClick();
            }
        } catch {
            //
        }
    }

    async function onLoadMetadataButtonClick() {
        getPackEpubButton().disabled = true;
        document.getElementById("LibAddToLibrary").disabled = true;
        let url = getValueFromUiField("metadataUrlInput");
        try {
            let xhr = await HttpClient.wrapFetch(url);
            populateMetadataAddWithDom(url, xhr.responseXML);
        } catch (error) {
            getLoadAndAnalyseButton().disabled = false;
            ErrorLog.showErrorMessage(error);
        }
    }

    function populateMetadataAddWithDom(url, dom) {
        try {
            let allTags = document.getElementById("lesstagsCheckbox").checked == false;
            let metaAddInfo = EpubMetaInfo.getEpubMetaAddInfo(dom, url, allTags);
            setUiFieldToValue("subjectInput", metaAddInfo.subject);
            setUiFieldToValue("descriptionInput", metaAddInfo.description);
            if (getValueFromUiField("authorInput")=="<unknown>") {
                setUiFieldToValue("authorInput", metaAddInfo.author);
            }
            getPackEpubButton().disabled = false;
            document.getElementById("LibAddToLibrary").disabled = false;
        } catch (error) {
            ErrorLog.showErrorMessage(error);
            getPackEpubButton().disabled = false;
            document.getElementById("LibAddToLibrary").disabled = false;
        }
    }

    // actions to do when window opened
    window.onload = async () => {
        TitleSuffixController.init();
        userPreferences = UserPreferences.readFromLocalStorage();
        if (isRunningInTabMode()) {
            ErrorLog.SuppressErrorLog =  false;
            localizeHtmlPage();
            getAdvancedOptionsSection().hidden = !userPreferences.advancedOptionsVisibleByDefault.value;
            getAdditionalMetadataSection().hidden = !userPreferences.ShowMoreMetadataOptions.value;
            addEventHandlers();
            populateControls();
            if (util.isFirefox()) {
                Firefox.startWebRequestListeners();
            }
        } else {
            await openTabWindow();
        }
    };

    return {
        getPackEpubButton: getPackEpubButton,
        onLoadAndAnalyseButtonClick : onLoadAndAnalyseButtonClick,
        fetchContentAndPackEpub: fetchContentAndPackEpub,
        resetUI: resetUI,
        getUserPreferences: () => userPreferences,
    };
})();

