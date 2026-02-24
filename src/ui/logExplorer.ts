import * as vscode from "vscode";
import type { WatchEntry } from "../types/config";
import type { Logger } from "../utils/logger";
import type { ConfigService } from "../types/configService";
import { EventType, type LogWatchProvider } from "../core/logProvider";
import { LogViewerSchema, toLogUri } from "../core/logUri";

export const openLogResourceCmd = "logviewerplus.openLogResource";
const unwatchCmd = "logviewerplus.unwatchLogResource";
const unwatchAllCmd = "logviewerplus.unwatchAll";
const selectFilesCmd = "logviewerplus.selectFiles";
const removeWatchCmd = "logviewerplus.removeWatch";

interface GroupItem {
    readonly id: string;
    readonly kind: "group";
    readonly parent: GroupItem | undefined;
    readonly name: string;
    readonly items: Item[];
}

interface WatchItem {
    readonly kind: "watch";
    readonly parent: GroupItem | undefined;
    readonly title?: string;
    readonly pattern: string | string[];
    readonly uri: vscode.Uri;
}

interface StatsItem {
    readonly kind: "stats";
    readonly parent: WatchItem;
    readonly label: string;
    readonly value: string;
    readonly icon: vscode.ThemeIcon;
    readonly level?: string;
}

type Item = GroupItem | WatchItem | StatsItem;

function toItem(entry: WatchEntry, parent: GroupItem | undefined, accIds: Set<string>): Item {
    if (entry.kind === "group") {
        const items: Item[] = [];
        const groupItem: GroupItem = {
            id: parent === undefined ? entry.groupName : `${parent.id}.${entry.groupName}`,
            kind: "group",
            parent,
            name: entry.groupName,
            items,
        };
        accIds.add(groupItem.id);
        for (const x of entry.watches) {
            items.push(toItem(x, groupItem, accIds));
        }
        return groupItem;
    } else {
        return {
            kind: "watch",
            parent,
            pattern: entry.pattern,
            title: entry.title,
            uri: toLogUri(entry),
        };
    }
}

class LogExplorer implements vscode.TreeDataProvider<Item>, vscode.Disposable {
    private readonly disposable: vscode.Disposable;

    public static readonly ViewId: string = "logExplorer";

    private readonly _onDidChange: vscode.EventEmitter<undefined>;

    private rootItems: Item[] = [];

    constructor(
        private readonly logProvider: LogWatchProvider,
        private readonly configSvc: ConfigService,
        private readonly expandedIds: Set<string>,
    ) {
        this._onDidChange = new vscode.EventEmitter();

        this.disposable = vscode.Disposable.from(
            this._onDidChange,
            configSvc.onChange(() => {
                this.reload();
            }),
            logProvider.onChange(e => {
                if (e.type === EventType.Start || e.type === EventType.Stop || e.type === EventType.ContentChange || e.type === EventType.FileChange) {
                    this.reload();
                }
            }),
        );

        this.updateItems();
    }

    private updateItems() {
        const validIds = new Set<string>();
        this.rootItems = this.configSvc.getWatches().map(x => toItem(x, undefined, validIds));
        for (const id of this.expandedIds.values()) {
            if (!validIds.has(id)) {
                this.expandedIds.delete(id);
            }
        }
    }

    public get onDidChangeTreeData() {
        return this._onDidChange.event;
    }

    private reload() {
        this.updateItems();
        this._onDidChange.fire(undefined);
    }

    public getTreeItem(element: Item) {
        if (element.kind === "group") {
            const item = new vscode.TreeItem(
                element.name,
                this.expandedIds.has(element.id)
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed,
            );
            item.id = element.id;
            return item;
        } else if (element.kind === "stats") {
            const item = new vscode.TreeItem(`${element.label}: ${element.value}`, vscode.TreeItemCollapsibleState.None);
            item.iconPath = element.icon;
            item.tooltip = element.level
                ? `${element.label}: ${element.value} — Click to filter by ${element.level}`
                : `${element.label}: ${element.value}`;
            if (element.level) {
                item.command = {
                    command: "logviewerplus.filterByLevel",
                    arguments: [element.level],
                    title: `Filter by ${element.level}`,
                };
            }
            return item;
        } else {
            const watching = this.logProvider.isWatching(element.uri);
            let name: string;
            if (element.title !== null && element.title !== undefined) {
                name = element.title;
            } else if (Array.isArray(element.pattern)) {
                name = element.pattern.join(",");
            } else {
                name = element.pattern;
            }
            const stats = watching ? this.logProvider.getStats(element.uri) : undefined;
            const item = new vscode.TreeItem(
                name,
                watching && stats
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None,
            );
            if (watching) {
                item.iconPath = new vscode.ThemeIcon("eye");
                item.contextValue = "watchItem-watching";
                if (stats) {
                    item.description = `${stats.totalLines} lines`;
                }
            } else {
                item.iconPath = undefined;
                item.contextValue = "watchItem";
            }
            item.command = {
                command: openLogResourceCmd,
                arguments: [element.uri],
                title: name,
                tooltip: name,
            };
            return item;
        }
    }

    public getParent(element: Item): GroupItem | WatchItem | undefined {
        return element.parent;
    }

    public getChildren(element?: Item): Item[] | undefined {
        if (element === undefined) {
            return this.rootItems;
        } 
        if (element.kind === "group") {
            return element.items;
        }
        if (element.kind === "watch" && this.logProvider.isWatching(element.uri)) {
            return this.getStatsChildren(element);
        }
    }

    private getStatsChildren(watchItem: WatchItem): StatsItem[] {
        const stats = this.logProvider.getStats(watchItem.uri);
        if (!stats) {
            return [];
        }

        const items: StatsItem[] = [];

        if (stats.errorCount > 0) {
            items.push({
                kind: "stats",
                parent: watchItem,
                label: "ERROR",
                value: String(stats.errorCount),
                icon: new vscode.ThemeIcon("error", new vscode.ThemeColor("list.errorForeground")),
                level: "ERROR",
            });
        }
        if (stats.warnCount > 0) {
            items.push({
                kind: "stats",
                parent: watchItem,
                label: "WARN",
                value: String(stats.warnCount),
                icon: new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground")),
                level: "WARN",
            });
        }
        if (stats.infoCount > 0) {
            items.push({
                kind: "stats",
                parent: watchItem,
                label: "INFO",
                value: String(stats.infoCount),
                icon: new vscode.ThemeIcon("info"),
                level: "INFO",
            });
        }
        if (stats.debugCount > 0) {
            items.push({
                kind: "stats",
                parent: watchItem,
                label: "DEBUG",
                value: String(stats.debugCount),
                icon: new vscode.ThemeIcon("debug-alt"),
                level: "DEBUG",
            });
        }
        if (stats.traceCount > 0) {
            items.push({
                kind: "stats",
                parent: watchItem,
                label: "TRACE",
                value: String(stats.traceCount),
                icon: new vscode.ThemeIcon("list-tree"),
                level: "TRACE",
            });
        }

        return items;
    }

    public dispose() {
        this.disposable.dispose();
    }
}

export interface LogExplorerTestHandles {
    treeDataProvider: vscode.TreeDataProvider<Item>;
    treeView: vscode.TreeView<Item>;
}

export function registerLogExplorer(
    logProvider: LogWatchProvider,
    subs: vscode.Disposable[],
    configSvc: ConfigService,
    logger: Logger,
    workspaceState: vscode.Memento,
): LogExplorerTestHandles {
    const expandedIdsStateKey = LogExplorer.ViewId + ".expandedIds";
    const expandedIds = new Set<string>(
        (() => {
            const json = workspaceState.get<string>(expandedIdsStateKey);
            if (json !== null && json !== undefined) {
                try {
                    return JSON.parse(json) as string[];
                } catch {
                    logger.error(`${expandedIdsStateKey}: failed to deserialize "${json}"`);
                }
            }
            return null;
        })(),
    );
    const logExplorer = new LogExplorer(logProvider, configSvc, expandedIds);
    const treeView = vscode.window.createTreeView(LogExplorer.ViewId, {
        treeDataProvider: logExplorer,
        showCollapseAll: true,
    });

    let updateStateHandle: NodeJS.Timeout | undefined;
    const queueStateUpdate = () => {
        clearTimeout(updateStateHandle);
        updateStateHandle = setTimeout(() => {
            const json = JSON.stringify(Array.from(expandedIds.values()));
            void workspaceState.update(expandedIdsStateKey, json);
        }, 250);
    };
    treeView.onDidCollapseElement(e => {
        if (e.element.kind === "group") {
            expandedIds.delete(e.element.id);
            queueStateUpdate();
        }
    });
    treeView.onDidExpandElement(e => {
        if (e.element.kind === "group") {
            expandedIds.add(e.element.id);
            queueStateUpdate();
        }
    });

    const descUnknown = (x: unknown): string => {
        if (typeof x === "string") {
            return x;
        }
        const s = String(x);
        if (s !== "[object Object]") {
            return s;
        }
        try {
            return JSON.stringify(s);
        } catch {
            return s;
        }
    };

    subs.push(
        vscode.Disposable.from(
            logExplorer,
            treeView,
            vscode.commands.registerCommand(openLogResourceCmd, async (logUri: unknown) => {
                let uri: vscode.Uri;
                if (logUri instanceof vscode.Uri) {
                    uri = logUri;
                } else if (typeof logUri === "string") {
                    uri = vscode.Uri.parse(logUri);
                } else {
                    logger.error(`unexpected argument type for "${openLogResourceCmd}": ${descUnknown(logUri)}`);
                    return;
                }
                try {
                    // Reset level filter when clicking on the file name
                    const filterOpts = configSvc.getEffectiveFilterOptions();
                    if (filterOpts.minLevel && filterOpts.minLevel !== "ALL") {
                        await configSvc.setFilterOverrides({ minLevel: "ALL" });
                    }
                    await logProvider.startWatch(uri, true);
                    const doc = await vscode.workspace.openTextDocument(uri);
                    await vscode.window.showTextDocument(doc, { preview: false });
                } catch (err) {
                    logger.error(`Failed to open log resource: ${err}`);
                    void vscode.window.showErrorMessage(`Failed to open log: ${err instanceof Error ? err.message : String(err)}`);
                }
            }),
            vscode.commands.registerCommand(unwatchCmd, (x: unknown) => {
                let uri: vscode.Uri | undefined;
                if (!x) {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor?.document.uri.scheme || editor.document.uri.scheme !== LogViewerSchema) {
                        return;
                    }
                    uri = editor.document.uri;
                } else if (typeof x === "string") {
                    uri = vscode.Uri.parse(x);
                } else if (typeof x === "object" && x !== null && "kind" in x && (x as Item).kind === "watch") {
                    uri = (x as WatchItem).uri;
                } else if (typeof x === "object" && x !== null && "uri" in x) {
                    const raw = (x as { uri: unknown }).uri;
                    if (raw instanceof vscode.Uri) {
                        uri = raw;
                    } else if (typeof raw === "string") {
                        uri = vscode.Uri.parse(raw);
                    }
                }
                if (!uri) {
                    logger.error(`"${unwatchCmd}": could not resolve URI from argument ${descUnknown(x)}`);
                    return;
                }
                logProvider.stopWatch(uri);
            }),
            vscode.commands.registerCommand(unwatchAllCmd, () => {
                logProvider.stopAllWatches();
            }),
            vscode.commands.registerCommand(removeWatchCmd, async (x: unknown) => {
                let pattern: string | undefined;
                if (typeof x === "object" && x !== null && "kind" in x && (x as Item).kind === "watch") {
                    const watchItem = x as WatchItem;
                    pattern = Array.isArray(watchItem.pattern) ? watchItem.pattern[0] : watchItem.pattern;
                }
                if (!pattern) {
                    logger.error(`"${removeWatchCmd}": could not resolve pattern from argument ${descUnknown(x)}`);
                    return;
                }

                const config = vscode.workspace.getConfiguration("logViewerPlus");
                const currentWatch = config.get<unknown[]>("watch") || [];

                // Remove only the first matching entry
                let removed = false;
                const filtered = currentWatch.filter(entry => {
                    if (removed) {
                        return true;
                    }
                    if (typeof entry === "string" && entry === pattern) {
                        removed = true;
                        return false;
                    }
                    if (typeof entry === "object" && entry !== null && "pattern" in entry) {
                        const p = (entry as { pattern: string | string[] }).pattern;
                        const entryPattern = Array.isArray(p) ? p[0] : p;
                        if (entryPattern === pattern) {
                            removed = true;
                            return false;
                        }
                    }
                    return true;
                });

                if (filtered.length === currentWatch.length) {
                    return;
                }

                // Stop watching if active
                if (typeof x === "object" && x !== null && "uri" in x) {
                    logProvider.stopWatch((x as WatchItem).uri);
                }

                const target = vscode.workspace.workspaceFolders?.length
                    ? vscode.ConfigurationTarget.Workspace
                    : vscode.ConfigurationTarget.Global;

                await config.update("watch", filtered, target);
            }),
            vscode.commands.registerCommand(selectFilesCmd, async () => {
                const files = await vscode.window.showOpenDialog({
                    canSelectMany: true,
                    canSelectFiles: true,
                    canSelectFolders: false,
                    filters: {
                        "Log files": ["log", "txt", "out"],
                        "All files": ["*"],
                    },
                    title: "Select log files to watch",
                });

                if (!files || files.length === 0) {
                    return;
                }

                const config = vscode.workspace.getConfiguration("logViewerPlus");
                const currentWatch = config.get<unknown[]>("watch") || [];

                // Collect existing patterns to avoid duplicates
                const existingPatterns = new Set<string>();
                for (const entry of currentWatch) {
                    if (typeof entry === "string") {
                        existingPatterns.add(entry);
                    } else if (typeof entry === "object" && entry !== null && "pattern" in entry) {
                        const p = (entry as { pattern: string | string[] }).pattern;
                        const pat = Array.isArray(p) ? p[0] : p;
                        existingPatterns.add(pat);
                    }
                }

                const newEntries = files
                    .map(file => ({
                        title: file.fsPath.split(/[\\/]/).pop() ?? file.fsPath,
                        pattern: file.fsPath.replaceAll("\\", "/"),
                    }))
                    .filter(entry => !existingPatterns.has(entry.pattern));

                if (newEntries.length === 0) {
                    vscode.window.showInformationMessage("Selected files are already in the watch list");
                    return;
                }

                const target = vscode.workspace.workspaceFolders?.length
                    ? vscode.ConfigurationTarget.Workspace
                    : vscode.ConfigurationTarget.Global;

                const updatedWatch = [...currentWatch, ...newEntries];
                await config.update("watch", updatedWatch, target);

                if (!vscode.workspace.workspaceFolders?.length) {
                    configSvc.forceReload();

                    // Auto-open newly added watches
                    const flattenWatches = (entries: import("../types/config").WatchEntry[]): import("../types/config").Watch[] =>
                        entries.flatMap(e => e.kind === "group" ? flattenWatches(e.watches as import("../types/config").WatchEntry[]) : [e]);

                    for (const w of flattenWatches(configSvc.getWatches())) {
                        const pat = Array.isArray(w.pattern) ? w.pattern[0] : w.pattern;
                        if (newEntries.some(e => e.pattern === pat)) {
                            const uri = toLogUri({
                                id: w.id,
                                title: w.title,
                                pattern: w.pattern,
                                workspaceName: undefined,
                            });
                            try {
                                const doc = await vscode.workspace.openTextDocument(uri);
                                await vscode.window.showTextDocument(doc, { preview: false });
                            } catch (err) {
                                logger.error(`Failed to open log: ${err}`);
                            }
                        }
                    }
                }
            }),
        ),
    );

    return {
        treeView: treeView,
        treeDataProvider: logExplorer,
    };
}
