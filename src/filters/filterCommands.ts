/**
 * Filter Commands for Log Viewer
 */

import * as vscode from "vscode";
import type { ConfigService } from "../types/configService";
import { isFilterActive } from "../types/config";
import { LogViewerSchema } from "../core/logUri";

const toggleFilterCmd = "logviewer.toggleFilter";
const enableFilterCmd = "logviewer.enableFilter";
const disableFilterCmd = "logviewer.disableFilter";
const setFilterLevelCmd = "logviewer.setFilterLevel";
const setFilterLevelActiveCmd = "logviewer.setFilterLevelActive";
const setSearchPatternCmd = "logviewer.setSearchPattern";
const clearSearchPatternCmd = "logviewer.clearSearchPattern";
const toggleCleanFormatCmd = "logviewer.toggleCleanFormat";
const enableCleanFormatCmd = "logviewer.enableCleanFormat";
const disableCleanFormatCmd = "logviewer.disableCleanFormat";
const configureFiltersCmd = "logviewer.configureFilters";
const exportFilteredCmd = "logviewer.exportFiltered";
const filterByLevelCmd = "logviewer.filterByLevel";

function updateFilterContextKeys(configSvc: ConfigService): void {
    const opts = configSvc.getEffectiveFilterOptions();
    const active = isFilterActive(opts);
    void vscode.commands.executeCommand("setContext", "logviewer.filterEnabled", active);
    void vscode.commands.executeCommand("setContext", "logviewer.levelActive", opts.minLevel !== "ALL" && opts.minLevel !== "TRACE");
    void vscode.commands.executeCommand("setContext", "logviewer.searchActive", !!opts.searchPattern);
    void vscode.commands.executeCommand("setContext", "logviewer.cleanFormatActive", opts.cleanFormat);
}

async function updateFilterConfig(
    updates: Partial<Record<"minLevel" | "searchPattern" | "cleanFormat", any>>,
): Promise<void> {
    const config = vscode.workspace.getConfiguration("logViewer");
    const currentFilter = config.get<any>("filter") || {};
    Object.assign(currentFilter, updates);
    await config.update("filter", currentFilter, vscode.ConfigurationTarget.Global);
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
            const filterConfig = vscode.workspace.getConfiguration("logViewer").get<any>("filter") || {};
            const currentLevel = filterConfig.minLevel || "ALL";
            const isAll = currentLevel === "ALL" || currentLevel === "TRACE";

            const levels = [
                { label: "ALL", description: "Show all logs (no level filter)", value: "ALL", picked: isAll },
                { label: "ERROR", description: "Show only ERROR logs", value: "ERROR", picked: currentLevel === "ERROR" },
                { label: "WARN", description: "Show WARN and above", value: "WARN", picked: currentLevel === "WARN" },
                { label: "INFO", description: "Show INFO and above", value: "INFO", picked: currentLevel === "INFO" },
                { label: "DEBUG", description: "Show DEBUG and above", value: "DEBUG", picked: currentLevel === "DEBUG" },
                { label: "TRACE", description: "Show TRACE and above", value: "TRACE", picked: currentLevel === "TRACE" && !isAll },
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
                value: vscode.workspace.getConfiguration("logViewer").get<any>("filter")?.searchPattern || "",
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
            const config = vscode.workspace.getConfiguration("logViewer");
            const filterConfig = config.get<any>("filter") || {};
            const currentClean = filterConfig.cleanFormat || false;
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
            const config = vscode.workspace.getConfiguration("logViewer");
            const filterConfig = config.get<any>("filter") || {};

            const hasLevelFilter = filterConfig.minLevel && filterConfig.minLevel !== "ALL" && filterConfig.minLevel !== "TRACE";
            const hasSearchFilter = !!filterConfig.searchPattern;
            const hasAnyFilter = hasLevelFilter || hasSearchFilter || filterConfig.cleanFormat;

            const options = [
                {
                    label: `$(${hasAnyFilter ? "check" : "circle-outline"}) Clear All Filters`,
                    description: hasAnyFilter ? "Filters are active" : "No active filters",
                    action: "clearAll",
                },
                {
                    label: `$(${hasLevelFilter ? "filter-filled" : "list-unordered"}) Set Filter Level`,
                    description: `Current: ${!filterConfig.minLevel || filterConfig.minLevel === "ALL" || filterConfig.minLevel === "TRACE" ? "ALL" : filterConfig.minLevel}`,
                    action: "setLevel",
                },
                {
                    label: `$(${hasSearchFilter ? "search-stop" : "search"}) Set Search Pattern`,
                    description: filterConfig.searchPattern
                        ? `Current: ${filterConfig.searchPattern}`
                        : "No pattern set",
                    action: "setPattern",
                },
                {
                    label: `$(${filterConfig.cleanFormat ? "list-flat" : "list-tree"}) Clean Format`,
                    description: filterConfig.cleanFormat
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
    registerToggleFilter(subs);
    registerEnableDisableFilter(subs);
    registerSetFilterLevel(subs);
    registerSetSearchPattern(subs);
    registerClearSearchPattern(subs);
    registerToggleCleanFormat(subs);
    registerEnableDisableCleanFormat(subs);
    registerConfigureFilters(subs);
    registerExportFiltered(subs);

    // Set initial context keys and update on config change
    updateFilterContextKeys(configSvc);
    subs.push(configSvc.onChange(() => updateFilterContextKeys(configSvc)));
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
