"use strict";

const TitleSuffixHelpers = (function() {
    const CHAPTER_KEYWORD_PATTERN = /\b(?:chapter|chap|ch|episode|ep|part)\b[^\divxlcdm]{0,32}(\d+(?:\.\d+)?|[ivxlcdm]+)/i;
    const LEADING_NUMBER_PATTERN = /^[-\u2013\u2014\s]*(\d+(?:\.\d+)?|[ivxlcdm]+)/i;
    const GENERIC_NUMBER_PATTERN = /\d+(?:\.\d+)?/;
    const MAX_KEYWORD_OFFSET = 64;
    const MAX_GENERIC_NUMBER_OFFSET = 24;

    function extractChapterLabel(title) {
        if (util.isNullOrEmpty(title)) {
            return null;
        }
        let normalized = title.replace(/\s+/g, " ").trim();
        if (normalized === "") {
            return null;
        }

        let trailingNumberMatch = normalized.match(/^(.*?)(\d+(?:\.\d+)?)\s*$/);
        if (trailingNumberMatch) {
            let beforeNumber = trailingNumberMatch[1].replace(/[:\-\u2013\u2014]+\s*$/, "").trim();
            if (beforeNumber !== "") {
                let chapterVariantAtEnd = /(\b(?:ch\.?\,?|chap(?:ter)?|chapter)\b)$/i;
                if (!chapterVariantAtEnd.test(beforeNumber)) {
                    return null;
                }
            }
        }

        let keywordMatch = normalized.match(CHAPTER_KEYWORD_PATTERN);
        if (keywordMatch && keywordMatch.index <= MAX_KEYWORD_OFFSET) {
            return normalizeChapterNumber(keywordMatch[1]);
        }
        let leadingMatch = normalized.match(LEADING_NUMBER_PATTERN);
        if (leadingMatch) {
            let normalizedLeading = normalizeChapterNumber(leadingMatch[1]);
            if (normalizedLeading != null) {
                return normalizedLeading;
            }
        }
        let genericMatch = normalized.match(GENERIC_NUMBER_PATTERN);
        if (genericMatch && genericMatch.index <= MAX_GENERIC_NUMBER_OFFSET) {
            return genericMatch[0];
        }
        return null;
    }

    function normalizeChapterNumber(rawValue) {
        if (util.isNullOrEmpty(rawValue)) {
            return null;
        }
        let trimmed = rawValue.toString().trim();
        if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
            return trimmed;
        }
        if (/^[ivxlcdm]+$/i.test(trimmed)) {
            let numeric = parseRomanNumeral(trimmed);
            if (numeric != null) {
                return numeric.toString();
            }
        }
        return null;
    }

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
        extractChapterLabel: extractChapterLabel
    };
})();

window.TitleSuffixHelpers = TitleSuffixHelpers;