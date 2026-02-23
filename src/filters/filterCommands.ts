/**
 * Filter Commands for Log Viewer Plus
 */

import * as vscode from "vscode";
import type { ConfigService } from "../types/configService";
import { isFilterActive } from "../types/config";
import { LogViewerSchema } from "../core/logUri";

const toggleFilterCmd = "logviewerplus.toggleFilter";
const enableFilterCmd = "logviewerplus.enableFilter";
const disableFilterCmd = "logviewerplus.disableFilter";
const setFilterLevelCmd = "logviewerplus.setFilterLevel";
const setFilterLevelActiveCmd = "logviewerplus.setFilterLevelActive";
const setSearchPatternCmd = "logviewerplus.setSearchPattern";
const clearSearchPatternCmd = "logviewerplus.clearSearchPattern";
const toggleCleanFormatCmd = "logviewerplus.toggleCleanFormat";
const enableCleanFormatCmd = "logviewerplus.enableCleanFormat";
const disableCleanFormatCmd = "logviewerplus.disableCleanFormat";
const configureFiltersCmd = "logviewerplus.configureFilters";
const exportFilteredCmd = "logviewerplus.exportFiltered";
const filterByLevelCmd = "logviewerplus.filterByLevel";
const setReadModeCmd = "logviewerplus.setReadMode";
const setReadModeFullCmd = "logviewerplus.setReadModeFull";
const setReadModeTailCmd = "logviewerplus.setReadModeTail";

let _configSvc: ConfigService;

function updateFilterContextKeys(): void {
    const opts = _configSvc.getEffectiveFilterOptions();
    const active = isFilterActive(opts);
    void vscode.commands.executeCommand("setContext", "logviewerplus.filterEnabled", active);
    void vscode.commands.executeCommand("setContext", "logviewerplus.levelActive", opts.minLevel !== "ALL" && opts.minLevel !== "TRACE");
    void vscode.commands.executeCommand("setContext", "logviewerplus.searchActive", !!opts.searchPattern);
    void vscode.commands.executeCommand("setContext", "logviewerplus.cleanFormatActive", opts.cleanFormat);

    const tailLines = _configSvc.getEffectiveTailLines();
    void vscode.commands.executeCommand("setContext", "logviewerplus.tailMode", tailLines > 0);
}

async function updateFilterConfig(
    updates: Partial<Record<"minLevel" | "searchPattern" | "cleanFormat", any>>,
): Promise<void> {
    await _configSvc.setFilterOverrides(updates);
}

function registerToggleFilter(subs: vscode.Disposable[]): void {
    subs.push(
        vscode.commands.registerCommand(toggleFilterCmd, async () => {
            // Clear all filters
            await updateFilterConfig({ minLevel: "ALL", searchPattern: undefined, cleanFormat: false });
            vscode.window.showInformationMessage("All filters cleared");
        }),
    );
}

function registerEnableDisableFilter(subs: vscode.Disposable[]): void {
    subs.push(
        vscode.commands.registerCommand(enableFilterCmd, async () => {
            // No-op: filters are now always active when set
            vscode.window.showInformationMessage("Filters activate automatically when set");
        }),
        vscode.commands.registerCommand(disableFilterCmd, async () => {
            // Clear all filters
            await updateFilterConfig({ minLevel: "ALL", searchPattern: undefined, cleanFormat: false });
            vscode.window.showInformationMessage("All filters cleared");
        }),
    );
}

function showFilterLevelPicker(): Promise<void> {
    return new Promise<void>((resolve) => {
        void (async () => {
            const filterOpts = _configSvc.getEffectiveFilterOptions();
            const currentLevel = filterOpts.minLevel || "ALL";
            const isAll = currentLevel === "ALL" || currentLevel === "TRACE";

            const levels = [
                { label: "ALL", description: "Show all logs (no level filter)", value: "ALL", picked: isAll },
                { label: "ERROR", description: "Show only ERROR logs", value: "ERROR", picked: currentLevel === "ERROR" },
                { label: "WARN", description: "Show only WARN logs", value: "WARN", picked: currentLevel === "WARN" },
                { label: "INFO", description: "Show only INFO logs", value: "INFO", picked: currentLevel === "INFO" },
                { label: "DEBUG", description: "Show only DEBUG logs", value: "DEBUG", picked: currentLevel === "DEBUG" },
                { label: "TRACE", description: "Show only TRACE logs", value: "TRACE", picked: currentLevel === "TRACE" && !isAll },
            ].map(l => ({
                ...l,
                description: l.picked ? `${l.description} $(check)` : l.description,
            }));

            const displayLevel = isAll ? "ALL" : currentLevel;
            const level = await vscode.window.showQuickPick(levels, {
                placeHolder: `Current: ${displayLevel} — Select minimum log level`,
            });

            if (level) {
                if (level.value === "ALL") {
                    await updateFilterConfig({ minLevel: "ALL" });
                    vscode.window.showInformationMessage("Level filter cleared (showing all)");
                } else {
                    await updateFilterConfig({ minLevel: level.value });
                    vscode.window.showInformationMessage(`Filter level set to ${level.value}`);
                }
            }
            resolve();
        })();
    });
}

function registerSetFilterLevel(subs: vscode.Disposable[]): void {
    subs.push(
        vscode.commands.registerCommand(setFilterLevelCmd, () => showFilterLevelPicker()),
        vscode.commands.registerCommand(setFilterLevelActiveCmd, () => showFilterLevelPicker()),
        vscode.commands.registerCommand(filterByLevelCmd, async (level: string) => {
            if (level) {
                await updateFilterConfig({ minLevel: level });
                vscode.window.showInformationMessage(`Filter level set to ${level}`);
            }
        }),
    );
}

function registerSetSearchPattern(subs: vscode.Disposable[]): void {
    subs.push(
        vscode.commands.registerCommand(setSearchPatternCmd, async () => {
            const pattern = await vscode.window.showInputBox({
                prompt: "Enter search pattern (text or regex)",
                placeHolder: "e.g., UNREGISTERING or Error.*Exception",
                value: _configSvc.getEffectiveFilterOptions().searchPattern || "",
            });

            if (pattern !== undefined) {
                if (pattern === "") {
                    await updateFilterConfig({ searchPattern: undefined });
                    vscode.window.showInformationMessage("Search pattern cleared");
                } else {
                    await updateFilterConfig({ searchPattern: pattern });
                    vscode.window.showInformationMessage(`Search pattern set to: ${pattern}`);
                }
            }
        }),
    );
}

function registerClearSearchPattern(subs: vscode.Disposable[]): void {
    subs.push(
        vscode.commands.registerCommand(clearSearchPatternCmd, async () => {
            await updateFilterConfig({ searchPattern: undefined });
            vscode.window.showInformationMessage("Search pattern cleared");
        }),
    );
}

function registerToggleCleanFormat(subs: vscode.Disposable[]): void {
    subs.push(
        vscode.commands.registerCommand(toggleCleanFormatCmd, async () => {
            const filterOpts = _configSvc.getEffectiveFilterOptions();
            const currentClean = filterOpts.cleanFormat || false;
            await updateFilterConfig({ cleanFormat: !currentClean });
            vscode.window.showInformationMessage(
                `Clean format ${currentClean ? "disabled" : "enabled"} (showing ${currentClean ? "full log lines" : "messages only"})`,
            );
        }),
    );
}

function registerEnableDisableCleanFormat(subs: vscode.Disposable[]): void {
    subs.push(
        vscode.commands.registerCommand(enableCleanFormatCmd, async () => {
            await updateFilterConfig({ cleanFormat: true });
            vscode.window.showInformationMessage("Clean format enabled (showing messages only)");
        }),
        vscode.commands.registerCommand(disableCleanFormatCmd, async () => {
            await updateFilterConfig({ cleanFormat: false });
            vscode.window.showInformationMessage("Clean format disabled (showing full log lines)");
        }),
    );
}

function registerConfigureFilters(subs: vscode.Disposable[]): void {
    subs.push(
        vscode.commands.registerCommand(configureFiltersCmd, async () => {
            const filterOpts = _configSvc.getEffectiveFilterOptions();

            const hasLevelFilter = filterOpts.minLevel && filterOpts.minLevel !== "ALL" && filterOpts.minLevel !== "TRACE";
            const hasSearchFilter = !!filterOpts.searchPattern;
            const hasAnyFilter = hasLevelFilter || hasSearchFilter || filterOpts.cleanFormat;

            const options = [
                {
                    label: `$(${hasAnyFilter ? "check" : "circle-outline"}) Clear All Filters`,
                    description: hasAnyFilter ? "Filters are active" : "No active filters",
                    action: "clearAll",
                },
                {
                    label: `$(${hasLevelFilter ? "filter-filled" : "list-unordered"}) Set Filter Level`,
                    description: `Current: ${!filterOpts.minLevel || filterOpts.minLevel === "ALL" || filterOpts.minLevel === "TRACE" ? "ALL" : filterOpts.minLevel}`,
                    action: "setLevel",
                },
                {
                    label: `$(${hasSearchFilter ? "search-stop" : "search"}) Set Search Pattern`,
                    description: filterOpts.searchPattern
                        ? `Current: ${filterOpts.searchPattern}`
                        : "No pattern set",
                    action: "setPattern",
                },
                {
                    label: `$(${filterOpts.cleanFormat ? "list-flat" : "list-tree"}) Clean Format`,
                    description: filterOpts.cleanFormat
                        ? "Show message only"
                        : "Show full log line",
                    action: "toggleClean",
                },
                {
                    label: "$(export) Export Filtered Log",
                    description: "Save current filtered content to a file",
                    action: "export",
                },
            ];

            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: "Configure log filters",
            });

            if (selected) {
                switch (selected.action) {
                    case "clearAll":
                        await vscode.commands.executeCommand(toggleFilterCmd);
                        break;
                    case "setLevel":
                        await vscode.commands.executeCommand(setFilterLevelCmd);
                        break;
                    case "setPattern":
                        await vscode.commands.executeCommand(setSearchPatternCmd);
                        break;
                    case "toggleClean":
                        await vscode.commands.executeCommand(toggleCleanFormatCmd);
                        break;
                    case "export":
                        await vscode.commands.executeCommand(exportFilteredCmd);
                        break;
                }
            }
        }),
    );
}

function registerExportFiltered(subs: vscode.Disposable[]): void {
    subs.push(
        vscode.commands.registerCommand(exportFilteredCmd, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor?.document.uri.scheme || editor.document.uri.scheme !== LogViewerSchema) {
                vscode.window.showWarningMessage("Open a log viewer document first");
                return;
            }

            const content = editor.document.getText();
            if (!content || content === "no matching file found") {
                vscode.window.showWarningMessage("No content to export");
                return;
            }

            const savePath = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file("filtered-log.log"),
                filters: {
                    "Log files": ["log", "txt"],
                    "All files": ["*"],
                },
                title: "Export filtered log",
            });

            if (savePath) {
                const encoder = new TextEncoder();
                await vscode.workspace.fs.writeFile(savePath, encoder.encode(content));
                const openFile = await vscode.window.showInformationMessage(
                    `Filtered log exported to ${savePath.fsPath}`,
                    "Open file",
                );
                if (openFile) {
                    const doc = await vscode.workspace.openTextDocument(savePath);
                    await vscode.window.showTextDocument(doc);
                }
            }
        }),
    );
}

export function registerFilterCommands(subs: vscode.Disposable[], configSvc: ConfigService): void {
    _configSvc = configSvc;
    registerToggleFilter(subs);
    registerEnableDisableFilter(subs);
    registerSetFilterLevel(subs);
    registerSetSearchPattern(subs);
    registerClearSearchPattern(subs);
    registerToggleCleanFormat(subs);
    registerEnableDisableCleanFormat(subs);
    registerConfigureFilters(subs);
    registerExportFiltered(subs);
    registerReadMode(subs);

    // Set initial context keys and update on config change
    updateFilterContextKeys();
    subs.push(configSvc.onChange(() => updateFilterContextKeys()));
}

interface FilterStatusBarItemProps {
    configSvc: ConfigService;
}

export function createFilterStatusBarItem(
    subs: vscode.Disposable[],
    props: FilterStatusBarItemProps,
): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    subs.push(item);

    const updateItem = () => {
        const filterOptions = props.configSvc.getEffectiveFilterOptions();
        
        const active = isFilterActive(filterOptions);
        if (active) {
            const parts: string[] = [];
            if (filterOptions.minLevel !== "ALL" && filterOptions.minLevel !== "TRACE") {
                parts.push(`Level: ${filterOptions.minLevel}`);
            }
            if (filterOptions.searchPattern) {
                parts.push(`Search: ${filterOptions.searchPattern}`);
            }
            if (filterOptions.cleanFormat) {
                parts.push("Clean format");
            }
            
            item.text = `$(filter-filled) Filters: On`;
            item.tooltip = `Active filters:\n${parts.join("\n")}\n\nClick to configure`;
        } else {
            item.text = "$(filter) Filters: Off";
            item.tooltip = "Click to configure log filters";
        }
    };

    item.command = configureFiltersCmd;
    
    subs.push(
        props.configSvc.onChange(() => updateItem()),
        vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
            if (editor?.document.uri.scheme === LogViewerSchema) {
                item.show();
                updateItem();
            } else {
                item.hide();
            }
        }),
    );

    // Initial update
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.scheme === LogViewerSchema) {
        item.show();
        updateItem();
    }

    return item;
}

function registerReadMode(subs: vscode.Disposable[]): void {
    async function showReadModePicker(): Promise<void> {
        const currentTail = _configSvc.getEffectiveTailLines();
        const isTail = currentTail > 0;

        const options = [
            {
                label: "Full file",
                description: isTail ? "Read the entire file" : "Read the entire file $(check)",
                value: 0,
            },
            {
                label: "Last 500 lines",
                description: currentTail === 500 ? "$(check)" : "",
                value: 500,
            },
            {
                label: "Last 1000 lines",
                description: currentTail === 1000 ? "$(check)" : "",
                value: 1000,
            },
            {
                label: "Last 5000 lines",
                description: currentTail === 5000 ? "$(check)" : "",
                value: 5000,
            },
            {
                label: "Last 10000 lines",
                description: currentTail === 10000 ? "$(check)" : "",
                value: 10000,
            },
            {
                label: "Custom...",
                description: "Enter a custom number of lines",
                value: -1,
            },
        ];

        const currentMode = isTail ? `Last ${currentTail} lines` : "Full file";
        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: `Current: ${currentMode} — Select read mode`,
        });

        if (!selected) {
            return;
        }

        let newValue = selected.value;
        if (newValue === -1) {
            const input = await vscode.window.showInputBox({
                prompt: "Enter number of lines (0 = full file)",
                value: String(currentTail),
                validateInput: (v) => {
                    const n = Number(v);
                    if (Number.isNaN(n) || !Number.isInteger(n) || n < 0) {
                        return "Enter a non-negative integer";
                    }
                    return undefined;
                },
            });
            if (input === undefined) {
                return;
            }
            newValue = Number(input);
        }

        await _configSvc.setTailLines(newValue);
        vscode.window.showInformationMessage(
            newValue === 0 ? "Read mode: Full file" : `Read mode: Last ${newValue} lines`,
        );
    }

    subs.push(
        vscode.commands.registerCommand(setReadModeCmd, () => showReadModePicker()),
        vscode.commands.registerCommand(setReadModeFullCmd, () => showReadModePicker()),
        vscode.commands.registerCommand(setReadModeTailCmd, () => showReadModePicker()),
    );
}
