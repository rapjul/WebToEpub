"use strict";

/** Class that handles UI for selecting (chapter) URLs to fetch */
class ChapterUrlsUI {
    constructor(parser) {
        this.parser = parser;
        ChapterUrlsUI.getPleaseWaitMessageRow().hidden = false;
        if (this.parser)
        {
            let nameElement = document.getElementById("spanParserName");
            if (nameElement) nameElement.textContent = this.parser.constructor.name;

            let delayMsElement = document.getElementById("spanDelayMs");
            if (delayMsElement) delayMsElement.textContent = `${this.parser.getRateLimit()} ms`;
        }

        let formElement = document.getElementById("sbFiltersForm");
        if (formElement) {
            document.getElementById("sbFiltersForm").onsubmit = (event) => {
                event.preventDefault();
            };
        }
    }

    connectButtonHandlers() {
        document.getElementById("selectAllUrlsButton").onclick = ChapterUrlsUI.setAllUrlsSelectState.bind(null, true);
        document.getElementById("unselectAllUrlsButton").onclick = ChapterUrlsUI.setAllUrlsSelectState.bind(null, false);
        document.getElementById("reverseChapterUrlsOrderButton").onclick = this.reverseUrls.bind(this);
        document.getElementById("editChaptersUrlsButton").onclick = this.setEditInputMode.bind(this);
        document.getElementById("copyUrlsToClipboardButton").onclick = this.copyUrlsToClipboard.bind(this);
        document.getElementById("showChapterUrlsCheckbox").onclick = this.toggleShowUrlsForChapterRanges.bind(this);
        ChapterUrlsUI.modifyApplyChangesButtons(button => button.onclick = this.setTableMode.bind(this));
    }

    populateChapterUrlsTable(chapters) {
        ChapterUrlsUI.getPleaseWaitMessageRow().hidden = true;
        ChapterUrlsUI.clearChapterUrlsTable();
        let linksTable = ChapterUrlsUI.getChapterUrlsTable();
        let index = 0;
        let rangeStart = ChapterUrlsUI.getRangeStartChapterSelect();
        let rangeEnd = ChapterUrlsUI.getRangeEndChapterSelect();
        let memberForTextOption = ChapterUrlsUI.textToShowInRange();
        chapters.forEach((chapter) => {
            let row = document.createElement("tr");
            ChapterUrlsUI.appendCheckBoxToRow(row, chapter);
            ChapterUrlsUI.appendInputTextToRow(row, chapter);
            chapter.row = row;
            ChapterUrlsUI.appendColumnDataToRow(row, chapter.sourceUrl);
            linksTable.appendChild(row);
            ChapterUrlsUI.appendOptionToSelect(rangeStart, index, chapter, memberForTextOption);
            ChapterUrlsUI.appendOptionToSelect(rangeEnd, index, chapter, memberForTextOption);
            ++index;
        });
        ChapterUrlsUI.setRangeOptionsToFirstAndLastChapters();
        this.showHideChapterUrlsColumn();
        ChapterUrlsUI.resizeTitleColumnToFit(linksTable);
    }

    showTocProgress(chapters) {
        let linksTable = ChapterUrlsUI.getChapterUrlsTable();
        chapters.forEach((chapter) => {
            let row = document.createElement("tr");
            linksTable.appendChild(row);
            row.appendChild(document.createElement("td"));
            let col = document.createElement("td");
            col.className = "disabled";
            col.appendChild(document.createTextNode(chapter.title));
            row.appendChild(col);
            row.appendChild(document.createElement("td"));
        });
    }

    static showDownloadState(row, state) {
        if (row != null) {
            let downloadStateDiv = row.querySelector(".downloadStateDiv");
            ChapterUrlsUI.updateDownloadStateImage(downloadStateDiv, state);
        }
    }

    static updateDownloadStateImage(downloadStateDiv, state) {
        let img = downloadStateDiv.querySelector("img");
        if (img) {
            img.src = ChapterUrlsUI.ImageForState[state];

            // Update tooltip
            let tooltipText = ChapterUrlsUI.TooltipForSate[state];
            let tooltipTextSpan = downloadStateDiv.querySelector(".tooltipText");

            if (tooltipText && !tooltipTextSpan) {
                tooltipTextSpan = document.createElement("span");
                tooltipTextSpan.className = "tooltipText";
                tooltipTextSpan.textContent = tooltipText;
                downloadStateDiv.appendChild(tooltipTextSpan);
            } else if (tooltipText) {
                tooltipTextSpan.textContent = tooltipText;
            } else if (tooltipTextSpan) {
                // Remove tooltip text if there is no text to display
                downloadStateDiv.removeChild(tooltipTextSpan);
            }
        }
    }

    static resetDownloadStateImages() {
        let linksTable = ChapterUrlsUI.getChapterUrlsTable();
        let prevDownload = ChapterUrlsUI.ImageForState[ChapterUrlsUI.DOWNLOAD_STATE_PREVIOUS];
        let downloaded = ChapterUrlsUI.ImageForState[ChapterUrlsUI.DOWNLOAD_STATE_LOADED];

        for (let downloadStateDiv of linksTable.querySelectorAll(".downloadStateDiv")) {
            let state = ChapterUrlsUI.DOWNLOAD_STATE_NONE;
            let imgSrc = downloadStateDiv.querySelector("img")?.src;
            if (imgSrc) {
                const imagesIndex = imgSrc.indexOf("images/");
                if (imagesIndex !== -1) {
                    imgSrc = imgSrc.substring(imagesIndex);
                }
            }
            if (imgSrc === prevDownload || imgSrc === downloaded) {
                state = ChapterUrlsUI.DOWNLOAD_STATE_PREVIOUS;
            }
            ChapterUrlsUI.updateDownloadStateImage(downloadStateDiv, state);
        }
    }

    static clearChapterUrlsTable() {
        util.removeElements(ChapterUrlsUI.getTableRowsWithChapters());
        util.removeElements([...ChapterUrlsUI.getRangeStartChapterSelect().options]);
        util.removeElements([...ChapterUrlsUI.getRangeEndChapterSelect().options]);
    }

    static limitNumOfChapterS(maxChapters) {
        let max = util.isNullOrEmpty(maxChapters) ? 10000 : parseInt(maxChapters.replace(",", ""));
        let selectedRows = [...ChapterUrlsUI.getChapterUrlsTable().querySelectorAll("[type='checkbox'")]
            .filter(c => c.checked)
            .map(c => c.parentElement.parentElement);
        if (max< selectedRows.length ) {
            let message = UIText.Chapter.maxChaptersSelected(selectedRows.length, max);
            if (confirm(message) === false) {
                for (let row of selectedRows.slice(max)) {
                    ChapterUrlsUI.setRowCheckboxState(row, false);
                }
            }
        }
    }

    /** @private */
    static setRangeOptionsToFirstAndLastChapters()
    {
        let rangeStart = ChapterUrlsUI.getRangeStartChapterSelect();
        let rangeEnd = ChapterUrlsUI.getRangeEndChapterSelect();

        rangeStart.onchange = null;
        rangeEnd.onchange = null;

        rangeStart.selectedIndex = (rangeStart.length > 0) ? 0 : -1;
        rangeEnd.selectedIndex = (rangeEnd.length > 0) ? (rangeEnd.length - 1) : -1;
        let startIndex = ChapterUrlsUI.selectionToRowIndex(rangeStart);
        let endIndex = ChapterUrlsUI.selectionToRowIndex(rangeEnd);
        ChapterUrlsUI.setChapterCount(startIndex, endIndex);

        rangeStart.onchange = ChapterUrlsUI.onRangeChanged;
        rangeEnd.onchange = ChapterUrlsUI.onRangeChanged;
    }

    /** @private */
    static onRangeChanged() {
        let startIndex = ChapterUrlsUI.selectionToRowIndex(ChapterUrlsUI.getRangeStartChapterSelect());
        let endIndex = ChapterUrlsUI.selectionToRowIndex(ChapterUrlsUI.getRangeEndChapterSelect());
        let rc = new ChapterUrlsUI.RangeCalculator();

        for (let row of ChapterUrlsUI.getTableRowsWithChapters()) {
            let inRange = rc.rowInRange(row);
            ChapterUrlsUI.setRowCheckboxState(row, rc.rowInRange(row));
            row.hidden = !inRange;
        }
        ChapterUrlsUI.setChapterCount(startIndex, endIndex);
    }

    /**
     * Computes a one-based row index from a select element's current selection.
     * Returns `0` when the element is missing or has no selection; otherwise,
     * if the selected option has a numeric value, that value plus one is returned,
     * falling back to the selected index plus one.
     *
     * @param {HTMLSelectElement|null|undefined} selectElement - The select element to read the selection from.
     * @returns {number} The one-based row index, or `0` if no valid selection exists.
     */
    static selectionToRowIndex(selectElement) {
        if (!selectElement || selectElement.selectedIndex < 0) {
            return 0;
        }
        let option = selectElement.options[selectElement.selectedIndex];
        if (option && option.value !== "") {
            let parsedValue = Number.parseInt(option.value, 10);
            if (!Number.isNaN(parsedValue)) {
                return parsedValue + 1;
            }
        }
        return selectElement.selectedIndex + 1;
    }

    /**
     * Updates the chapter count display based on the current selection and notifies the title suffix controller.
     *
     * @private
     * @param {number} startIndex - The zero-based index of the first selected chapter.
     * @param {number} endIndex - The zero-based index of the last selected chapter.
     */
    static setChapterCount(startIndex, endIndex) {
        let summary = ChapterUrlsUI.getSelectionSummary(startIndex, endIndex);
        document.getElementById("spanChapterCount").textContent = summary.count;
        if (window.TitleSuffixController) {
            window.TitleSuffixController.onChapterSelectionChanged(summary.lastTitle, summary.count);
        }
    }

    /**
     * Computes a summary of the selected chapter rows within an optional index range.
     *
     * @param {number} startIndex - The first index (1-based) of the chapter rows to include; ignored if not finite or non-positive.
     * @param {number} endIndex - The last index (1-based) of the chapter rows to include; ignored if not finite or non-positive.
     * @returns {{count: number, lastTitle: string}} An object containing the number of selected chapters and the title of the last selected chapter (empty string if none).
     */
    static getSelectionSummary(startIndex, endIndex) {
        let rows = ChapterUrlsUI.getTableRowsWithChapters();
        if (Number.isFinite(startIndex) && Number.isFinite(endIndex) && (startIndex > 0) && (endIndex > 0)) {
            rows = rows.filter(row => ChapterUrlsUI.rowIsWithinRange(row, startIndex, endIndex));
        }
        let selected = rows.filter(row => ChapterUrlsUI.getRowCheckbox(row)?.checked);
        let count = selected.length;
        let lastTitle = (count > 0)
            ? ChapterUrlsUI.getRowTitle(selected[count - 1])
            : "";
        return {count, lastTitle};
    }

    /**
     * Calculates the number of chapters in an inclusive range.
     *
     * Returns `0` if either index is not finite, non-positive, or if `endIndex` is less than `startIndex`.
     *
     * @param {number} startIndex - The first chapter index (1-based).
     * @param {number} endIndex - The last chapter index (1-based).
     * @returns {number} The total number of chapters in the range, or `0` if invalid.
     */
    static calculateChapterCount(startIndex, endIndex) {
        if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) {
            return 0;
        }
        if ((startIndex <= 0) || (endIndex <= 0) || (endIndex < startIndex)) {
            return 0;
        }
        return endIndex - startIndex + 1;
    }

    /**
     * Returns the title of the last chapter within the specified index range,
     * preferring visible rows and falling back to any rows if none are visible.
     *
     * @param {number} startIndex - The starting index of the chapter range to consider.
     * @param {number} endIndex - The ending index of the chapter range to consider.
     * @returns {string} The title of the last chapter found in range, or an empty string if none exist.
     */
    static getLastVisibleChapterTitle(startIndex, endIndex) {
        let rows = ChapterUrlsUI.getTableRowsWithChapters()
            .filter(row => ChapterUrlsUI.rowIsWithinRange(row, startIndex, endIndex) && !row.hidden);
        if (rows.length === 0) {
            rows = ChapterUrlsUI.getTableRowsWithChapters()
                .filter(row => ChapterUrlsUI.rowIsWithinRange(row, startIndex, endIndex));
        }
        if (rows.length === 0) {
            return "";
        }
        return ChapterUrlsUI.getRowTitle(rows[rows.length - 1]);
    }

    static rowIsWithinRange(row, startIndex, endIndex) {
        if (!row) {
            return false;
        }
        return (row.rowIndex >= startIndex) && (row.rowIndex <= endIndex);
    }

    /**
     * Retrieves the text value from the first text input within the given row element.
     *
     * @param {HTMLElement | null | undefined} row - The row DOM element containing the text input.
     * @returns {string} The extracted text value, or an empty string if no input is found.
     */
    static getRowTitle(row) {
        return row?.querySelector("input[type='text']")?.value ?? "";
    }

    /**
     * Retrieves the first checkbox input element within the specified row.
     *
     * @param {HTMLElement} row - The row element to search for a checkbox input.
     * @returns {HTMLInputElement|null} The checkbox element if found, otherwise `null`.
     */
    static getRowCheckbox(row) {
        return row?.querySelector("input[type='checkbox']") ?? null;
    }

    /**
    * @private
    */
    static getChapterUrlsTable() {
        return document.getElementById("chapterUrlsTable");
    }

    /** @private */
    static getRangeStartChapterSelect() {
        return document.getElementById("selectRangeStartChapter");
    }

    /** @private */
    static getRangeEndChapterSelect() {
        return document.getElementById("selectRangeEndChapter");
    }

    /** @private */
    static textToShowInRange() {
        return document.getElementById("showChapterUrlsCheckbox").checked
            ? "sourceUrl"
            : "title";
    }

    /**
    * @private
    */
    static modifyApplyChangesButtons(mutator) {
        mutator(document.getElementById("applyChangesButton"));
        mutator(document.getElementById("applyChangesButton2"));
    }

    /**
    * @private
    */
    static getEditChaptersUrlsInput() {
        return document.getElementById("editChaptersUrlsInput");
    }

    /** @private */
    static getPleaseWaitMessageRow() {
        return document.getElementById("findingChapterUrlsMessageRow");
    }

    /** @private */
    static setAllUrlsSelectState(select) {
        for (let row of ChapterUrlsUI.getTableRowsWithChapters()) {
            ChapterUrlsUI.setRowCheckboxState(row, select);
            row.hidden = false;
        }
        ChapterUrlsUI.setRangeOptionsToFirstAndLastChapters();
    }

    /** @private */
    static setRowCheckboxState(row, checked) {
        let input = row.querySelector("input[type='checkbox']");
        if (input.checked !== checked) {
            input.checked = checked;
            input.onclick();
        }
    }

    static getTableRowsWithChapters() {
        let linksTable = ChapterUrlsUI.getChapterUrlsTable();
        return [...linksTable.querySelectorAll("tr")]
            .filter(r => r.querySelector("th") === null);
    }

    /**
     * Appends an inclusion checkbox to a chapter table row and wires up selection behavior,
     * updating chapter selection state, range selection with shift-click, and title suffix syncing.
     *
     * @private
     * @param {HTMLTableRowElement} row - The table row element to which the checkbox will be added.
     * @param {Object} chapter - The chapter data object whose selection and download state are managed.
     */
    static appendCheckBoxToRow(row, chapter) {
        chapter.isIncludeable = chapter.isIncludeable ?? true;
        chapter.previousDownload = chapter.previousDownload ?? false;

        const col = document.createElement("td");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = chapter.isIncludeable;
        checkbox.onclick = (event) => {
            chapter.isIncludeable = checkbox.checked;
            if (!event) return;

            ChapterUrlsUI.tellUserAboutShiftClick(event, row);

            if (event.shiftKey && (ChapterUrlsUI.lastSelectedRow !== null)) {
                ChapterUrlsUI.updateRange(ChapterUrlsUI.lastSelectedRow, row.rowIndex, checkbox.checked);
            } else {
                ChapterUrlsUI.lastSelectedRow = row.rowIndex;
            }

            // Keep title suffix/count in sync with actual selected chapters.
            if (window.TitleSuffixController) {
                let summary = ChapterUrlsUI.getSelectionSummary(
                    ChapterUrlsUI.selectionToRowIndex(ChapterUrlsUI.getRangeStartChapterSelect()),
                    ChapterUrlsUI.selectionToRowIndex(ChapterUrlsUI.getRangeEndChapterSelect())
                );
                window.TitleSuffixController.onChapterSelectionChanged(summary.lastTitle, summary.count);
            }
        };
        col.appendChild(checkbox);
        ChapterUrlsUI.addDownloadStateToCheckboxColumn(col, chapter.previousDownload);
        row.appendChild(col);
    }

    /**
     * Adds a download state indicator to the given checkbox column element.
     *
     * @param {HTMLElement} col - The table cell element to which the download state indicator will be appended.
     * @param {boolean} previousDownload - Indicates whether a previous download exists; controls the initial state image.
     * @returns {void}
     */
    static addDownloadStateToCheckboxColumn(col, previousDownload) {
        let downloadStateDiv = document.createElement("div");
        downloadStateDiv.className = "downloadStateDiv";
        let img = document.createElement("img");
        img.className = "downloadState";

        downloadStateDiv.appendChild(img);
        ChapterUrlsUI.updateDownloadStateImage(downloadStateDiv,
            previousDownload ? ChapterUrlsUI.DOWNLOAD_STATE_PREVIOUS : ChapterUrlsUI.DOWNLOAD_STATE_NONE
        );
        col.appendChild(downloadStateDiv);
    }

    /**
     * Appends a table cell containing a text input to the specified row for editing a chapter title.
     *
     * @private
     * @param {HTMLTableRowElement} row - The table row to which the input cell will be added.
     * @param {{ title: string }} chapter - The chapter object whose title is displayed and updated via the input.
     */
    static appendInputTextToRow(row, chapter) {
        let col = document.createElement("td");
        let input = document.createElement("input");
        input.type = "text";
        input.value = chapter.title;
        input.className = "fullWidth";
        input.addEventListener("blur", () => { chapter.title = input.value; },  true);
        col.appendChild(input);
        row.appendChild(col);
    }

    /**
     * Appends a new option element to a select element using chapter data.
     *
     * @param {HTMLSelectElement} select - The select element to which the option will be added.
     * @param {string|number} value - The value attribute for the newly created option.
     * @param {Object<string, any>} chapter - The chapter object containing display text.
     * @param {string} memberForTextOption - The property name in `chapter` used as the option's display text.
     */
    static appendOptionToSelect(select, value, chapter, memberForTextOption) {
        let option = new Option(chapter[memberForTextOption], value);
        select.add(option);
    }

    /** @private */
    static resizeTitleColumnToFit(linksTable) {
        let inputs = [...linksTable.querySelectorAll("input[type='text']")];
        let width = inputs.reduce((acc, element) => Math.max(acc, element.value.length), 0);
        if (0 < width) {
            inputs.forEach(i => i.size = width);
        }
    }

    /**
    * @private
    */
    static appendColumnDataToRow(row, textData) {
        let col = document.createElement("td");
        col.innerText = textData;
        col.style.whiteSpace = "nowrap";
        row.appendChild(col);
        return col;
    }

    /**
    * @public
    */
    static setVisibleUI(toTable) {
        // toggle mode
        ChapterUrlsUI.getEditChaptersUrlsInput().hidden = toTable;
        ChapterUrlsUI.getChapterUrlsTable().hidden = !toTable;
        document.getElementById("inputSection").hidden = !toTable;
        document.getElementById("coverUrlSection").hidden = !toTable;
        document.getElementById("chapterSelectControlsDiv").hidden = !toTable;
        ChapterUrlsUI.modifyApplyChangesButtons(button => button.hidden = toTable);
        document.getElementById("editURLsHint").hidden = toTable;
    }

    /**
    * @private
    */
    setTableMode() {
        try {
            let inputvalue = ChapterUrlsUI.getEditChaptersUrlsInput().value;
            let chapters;
            let lines = inputvalue.split("\n");
            lines = lines.filter(a => a.trim() != "").map(a => a.trim());
            if (URL.canParse(lines[0])) {
                chapters = this.URLsToChapters(lines);
            } else {
                chapters = this.htmlToChapters(inputvalue);
            }
            this.parser.setPagesToFetch(chapters);
            this.populateChapterUrlsTable(chapters);
            this.usingTable = true;
            ChapterUrlsUI.setVisibleUI(this.usingTable);
        } catch (err) {
            ErrorLog.showErrorMessage(err);
        }
    }

    /** @private */
    reverseUrls() {
        try {
            let chapters = [...this.parser.getPagesToFetch().values()];
            chapters.reverse();
            this.populateChapterUrlsTable(chapters);
            this.parser.setPagesToFetch(chapters);
        } catch (err) {
            ErrorLog.showErrorMessage(err);
        }
    }

    /**
    * @private
    */
    htmlToChapters(innerHtml) {
        let html = "<html><head><title></title><body>" + innerHtml + "</body></html>";
        let doc = util.sanitize(html);
        return [...doc.body.querySelectorAll("a")].map(a => util.hyperLinkToChapter(a));
    }

    /**
    * @private
    */
    URLsToChapters(URLs) {
        let returnchapters = URLs.map(e => ({
            sourceUrl: e,
            title: "[placeholder]"
        }));
        return returnchapters;
    }

    /** @private */
    copyUrlsToClipboard() {
        let text = this.chaptersToHTML([...this.parser.getPagesToFetch().values()]);
        navigator.clipboard.writeText(text);
    }

    /** @private */
    toggleShowUrlsForChapterRanges() {
        let chapters = [...this.parser.getPagesToFetch().values()];
        this.toggleShowUrlsForChapterRange(ChapterUrlsUI.getRangeStartChapterSelect(), chapters);
        this.toggleShowUrlsForChapterRange(ChapterUrlsUI.getRangeEndChapterSelect(), chapters);
        this.showHideChapterUrlsColumn();
    }

    /**
     * Toggles the visibility of the Chapter URLs column based on the
     * "Show Chapter URLs" checkbox state. When unchecked, the third
     * column (headers and cells) in the chapter URLs table is hidden.
     */
    showHideChapterUrlsColumn() {
        let hidden = !document.getElementById("showChapterUrlsCheckbox").checked;
        let table = ChapterUrlsUI.getChapterUrlsTable();
        for (let t of table.querySelectorAll("th:nth-of-type(3), td:nth-of-type(3)")) {
            t.hidden = hidden;
        }
    }

    /**
     * Updates the displayed option text for a select element to show URLs (or titles) for each chapter in the current range,
     * preserving the selected index and reattaching the range-change handler afterward.
     *
     * @param {HTMLSelectElement} select - The select element whose option labels will be updated for the current chapter range.
     * @param {Array<Object>} chapters - The list of chapter metadata objects, indexed to match the select options.
     */
    toggleShowUrlsForChapterRange(select, chapters) {
        select.onchange = null;
        let memberForTextOption = ChapterUrlsUI.textToShowInRange();
        for (let o of [...select.querySelectorAll("Option")]) {
            o.text = chapters[o.index][memberForTextOption];
        }
        let selectedIndex = select.selectedIndex;
        select.selectedIndex = selectedIndex;
        select.onchange = ChapterUrlsUI.onRangeChanged;
    }

    /**
    * @private
    */
    setEditInputMode() {
        this.usingTable = false;
        ChapterUrlsUI.setVisibleUI(this.usingTable);
        let input = ChapterUrlsUI.getEditChaptersUrlsInput();
        input.rows = Math.max(this.parser.getPagesToFetch().size, 20);
        input.value = this.chaptersToHTML([...this.parser.getPagesToFetch().values()]);
    }

    /**
     * Converts an array of includeable chapter objects into an HTML string of links separated by carriage returns.
     *
     * @param {Array<{ isIncludeable: boolean }>} chapters - Collection of chapter objects to render as links.
     * @returns {string} The generated HTML markup for the body containing chapter links.
     */
    chaptersToHTML(chapters) {
        let doc = util.sanitize("<html><head><title></title><body></body></html>");
        for (let chapter of chapters.filter(c => c.isIncludeable)) {
            doc.body.appendChild(this.makeLink(doc, chapter));
            doc.body.appendChild(doc.createTextNode("\r"));
        }
        return doc.body.innerHTML;
    }

    /**
     * Creates an anchor element linking to the chapter's source URL with the chapter title as text.
     *
     * @param {Document} doc - The document used to create the anchor element.
     * @param {{ sourceUrl: string, title: string }} chapter - The chapter metadata containing the URL and display title.
     * @returns {HTMLAnchorElement} The constructed anchor element pointing to the chapter's source.
     */
    makeLink(doc, chapter) {
        let link = doc.createElement("a");
        link.href = chapter.sourceUrl;
        link.appendChild(doc.createTextNode(chapter.title));
        return link;
    }

    /** @private */
    static updateRange(startRowIndex, endRowIndex, state) {
        let direction = startRowIndex < endRowIndex ? 1 : -1;
        let linkTable = ChapterUrlsUI.getChapterUrlsTable();
        for (let rowIndex = startRowIndex; rowIndex != endRowIndex; rowIndex += direction) {
            let row = linkTable.rows[rowIndex];
            ChapterUrlsUI.setRowCheckboxState(row, state);
        }
    }

    /** @private */
    static getTargetRow(target) {
        while ((target.tagName.toLowerCase() !== "tr") && (target.parentElement !== null)) {
            target = target.parentElement;
        }
        return target;
    }

    /** @private */
    static tellUserAboutShiftClick(event, row) {
        let userPreferences = main.getUserPreferences();
        if (userPreferences?.disableShiftClickAlert?.value) {
            return;
        }
        if (event.shiftKey || (ChapterUrlsUI.lastSelectedRow === null)) {
            return;
        }
        if (ChapterUrlsUI.ConsecutiveRowClicks == 5) {
            return;
        }
        let distance = Math.abs(row.rowIndex - ChapterUrlsUI.lastSelectedRow);
        if (distance !== 1) {
            ChapterUrlsUI.ConsecutiveRowClicks = 0;
            return;
        }
        ++ChapterUrlsUI.ConsecutiveRowClicks;
        if (ChapterUrlsUI.ConsecutiveRowClicks == 5) {
            alert(UIText.Chapter.shiftClickMessage);
        }
    }

    static Filters = {
        filterTermsFrequency: {},
        chapterList: {},
        init() {
            let rc = new ChapterUrlsUI.RangeCalculator();
            var filterTermsFrequency = {};
            let constantTerms = false; // To become a collection of all terms used in every link.
            var chapterList = ChapterUrlsUI.getTableRowsWithChapters().filter(item => rc.rowInRange(item)).map(item => {
                let filterObj =
                {
                    row: item,
                    values: Array.from(item.querySelectorAll("td")).map(item => item.innerText).join("/").split("/"),
                    valueString: ""
                };
                filterObj.values.push(item.querySelector("input[type='text']").value);
                filterObj.values = filterObj.values.filter(item => item.length > 3 && !item.startsWith("http"));
                filterObj.valueString = filterObj.values.join(" ");

                let recordFilterTerms = filterObj.valueString.toLowerCase().split(" ");
                recordFilterTerms.forEach(item => {
                    filterTermsFrequency[item] = (parseInt(filterTermsFrequency[item]) || 0) + 1;
                });

                if (!constantTerms)
                {
                    constantTerms = recordFilterTerms;
                }
                else
                {
                    constantTerms.filter(item => recordFilterTerms.indexOf(item) == -1).forEach(item =>{
                        constantTerms.splice(constantTerms.indexOf(item), 1);
                    });
                }

                return filterObj;
            });
            let minFilterTermCount = Math.min( 3, chapterList.length * 0.10 );
            filterTermsFrequency = Object.keys(filterTermsFrequency)
                .filter(key => constantTerms.indexOf(key) == -1 && filterTermsFrequency[key] > minFilterTermCount)
                .map(key => ({ key: key, value: filterTermsFrequency[key] } ));

            var calcValue = (filterTerm) => { return filterTerm.value * filterTerm.key.length; };

            this.filterTermsFrequency = filterTermsFrequency.sort((a, b) => {
                var hasHigherValue = calcValue(a) < calcValue(b);
                var hasEqualValue = calcValue(a) == calcValue(b);
                return hasHigherValue ? 1 : hasEqualValue ? 0 : -1;
            });
            this.chapterList = chapterList;
        },
        Filter() {
            let rc = new ChapterUrlsUI.RangeCalculator();
            let formResults = Object.fromEntries(new FormData(document.getElementById("sbFiltersForm")));
            let formKeys = Object.keys(formResults);
            formResults = formKeys.filter(key => key.indexOf("Hidden") == -1)
                .map(key => {
                    return {
                        key: key,
                        searchType: formResults[key],
                        value: formResults[`${key}Hidden`]
                    };
                });

            let includeChaps = null;
            let excludeChaps = null;
            if (formResults.filter(item => item.searchType == 1).length > 0)
            {
                includeChaps = new RegExp(formResults.filter(item => item.searchType == 1).map(item => item.value).join("|"), "i");
            }
            if (formResults.filter(item => item.searchType == -1).length > 0)
            {
                excludeChaps = new RegExp(formResults.filter(item => item.searchType == -1).map(item => item.value).join("|"), "i");
            }

            ChapterUrlsUI.Filters.chapterList.forEach(item => {
                let showChapter = rc.rowInRange(item.row);
                if (includeChaps) {
                    showChapter = showChapter && includeChaps.test(item.valueString);
                }
                if (excludeChaps) {
                    showChapter = showChapter && !excludeChaps.test(item.valueString);
                }
                ChapterUrlsUI.setRowCheckboxState(item.row, showChapter);
                item.row.hidden = !showChapter;
            });
            let visibleRows = ChapterUrlsUI.Filters.chapterList.filter(item => !item.row.hidden);
            document.getElementById("spanChapterCount").textContent = visibleRows.length;
            if (window.TitleSuffixController) {
                let lastTitle = (visibleRows.length > 0)
                    ? ChapterUrlsUI.getRowTitle(visibleRows[visibleRows.length - 1].row)
                    : "";
                window.TitleSuffixController.onChapterSelectionChanged(lastTitle, visibleRows.length);
            }
        },
        generateFiltersTable() {
            let retVal = document.createElement("table");

            let onClickEvent = (event) => {
                if (event == undefined || event == null) {
                    return;
                }

                if (event.target.classList.contains("exclude")) {
                    event.target.checked = false;
                    event.target.classList.remove("exclude");
                    event.target.value = 1;
                }
                else if (!event.target.indeterminate && !event.target.checked) {
                    event.target.value = -1;
                    event.target.checked = true;
                    event.target.indeterminate = true;
                    event.target.classList.add("exclude");
                }

                ChapterUrlsUI.Filters.Filter();
            };

            let row = document.createElement("tr");
            let col = document.createElement("td");
            let checkboxId = "chkFilterText";
            let el = document.createElement("input");
            el.type = "checkbox";
            el.name = checkboxId;
            el.id = checkboxId;
            el.value = 1;
            el.onclick = onClickEvent;
            el.onchange = (event) => {
                if (event == undefined || event == null) {
                    return;
                }
                event.target.parentElement.nextElementSibling.firstChild.disabled = !event.target.checked;
                ChapterUrlsUI.Filters.Filter();
            };
            col.appendChild(el);
            row.appendChild(col);
            col = document.createElement("td");
            el = document.createElement("input");
            el.type = "text";
            el.disabled = true;
            el.id = checkboxId + "Text";
            el.onchange = (event) => { event.target.nextElementSibling.value = event.target.value; ChapterUrlsUI.Filters.Filter(); };
            col.appendChild(el);
            el = document.createElement("input");
            el.type = "hidden";
            el.id = checkboxId + "Hidden";
            el.name = checkboxId + "Hidden";
            col.appendChild(el);
            row.appendChild(col);

            retVal.appendChild(row);

            ChapterUrlsUI.Filters.filterTermsFrequency.forEach((value, id) => {
                row = document.createElement("tr");
                col = document.createElement("td");
                col.setAttribute("width", "10px");

                checkboxId = "chkFilter" + id;
                let el = document.createElement("input");
                el.type = "checkbox";
                el.name = checkboxId;
                el.id = checkboxId;
                el.value = 1;
                el.onclick = onClickEvent;
                col.appendChild(el);

                el = document.createElement("input");
                el.type = "hidden";
                el.name = checkboxId+"Hidden";
                el.value = RegExp.escape(value.key);
                col.appendChild(el);
                row.appendChild(col);

                col = document.createElement("td");
                el = document.createElement("label");
                el.innerText = value.key;
                el.id = checkboxId + "Label";
                el.setAttribute("for", checkboxId);
                el.setAttribute("width", "100%");
                col.appendChild(el);
                row.appendChild(col);

                retVal.appendChild(row);
            });
            retVal.setAttribute("width", "100%");
            return retVal;
        }
    };
}
ChapterUrlsUI.RangeCalculator = class {
    constructor() {
        this.startIndex = ChapterUrlsUI.selectionToRowIndex(ChapterUrlsUI.getRangeStartChapterSelect());
        this.endIndex = ChapterUrlsUI.selectionToRowIndex(ChapterUrlsUI.getRangeEndChapterSelect());
    }
    rowInRange(row) {
        let index = row.rowIndex;
        return (this.startIndex <= index) && (index <= this.endIndex);
    }
};



ChapterUrlsUI.DOWNLOAD_STATE_NONE = 0;
ChapterUrlsUI.DOWNLOAD_STATE_DOWNLOADING = 1;
ChapterUrlsUI.DOWNLOAD_STATE_LOADED = 2;
ChapterUrlsUI.DOWNLOAD_STATE_SLEEPING = 3;
ChapterUrlsUI.DOWNLOAD_STATE_PREVIOUS = 4;
ChapterUrlsUI.ImageForState = [
    "images/ChapterStateNone.svg",
    "images/ChapterStateDownloading.svg",
    "images/FileEarmarkCheckFill.svg",
    "images/ChapterStateSleeping.svg",
    "images/FileEarmarkCheck.svg"
];
ChapterUrlsUI.TooltipForSate = [
    null,
    UIText.Chapter.tooltipChapterDownloading,
    UIText.Chapter.tooltipChapterDownloaded,
    UIText.Chapter.tooltipChapterSleeping,
    UIText.Chapter.tooltipChapterPreviouslyDownloaded
];

ChapterUrlsUI.lastSelectedRow = null;
ChapterUrlsUI.ConsecutiveRowClicks = 0;
