import * as os from "node:os";
import * as process from "node:process";
import * as vscode from "vscode";
import {
    DefaulOptions,
    DefaultFilterOptions,
    resolveVariables,
    VariableResolveContext,
    type ConfigTypeMap,
    type FilterOptions,
    type IConfigService,
    type Watch,
    type WatchEntry,
    type WatchOptions,
} from "../types/config";

interface ConfigGroup {
    readonly groupName: string;
    readonly watches: ReadonlyArray<ConfigEntry>;
}

interface ConfigWatch {
    readonly title: string | undefined;
    readonly pattern: string | string[];
    readonly workspaceName: string | undefined;
    readonly options: Partial<WatchOptions> | undefined;
}

type ConfigEntry = string | ConfigWatch | ConfigGroup;

interface InternalConfigTypeMap extends ConfigTypeMap {
    watch: ConfigEntry[] | undefined;
}

const configurationSection = "logViewerPlus";

function hasWorkspace(): boolean {
    return !!vscode.workspace.workspaceFolders?.length;
}

export class ConfigService implements vscode.Disposable, IConfigService {
    private readonly _onChange = new vscode.EventEmitter<void>();
    private config!: vscode.WorkspaceConfiguration & InternalConfigTypeMap;
    private readonly watches: WatchEntry[] = [];
    private readonly watchesById = new Map<number, Watch>();
    private seqId = 0;

    // In-memory overrides (never persisted without a workspace)
    private readonly _filterOverrides: Partial<FilterOptions> = {};
    private _tailLinesOverride: number | undefined = undefined;

    constructor() {
        this.load();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(configurationSection)) {
                this.load();
                this._onChange.fire();
            }
        });
    }

    private nextId() {
        return this.seqId++;
    }

    private readonly toWatchEntry = (configEntry: ConfigEntry, ctx: VariableResolveContext): WatchEntry => {
        if (typeof configEntry === "string") {
            const watch: Watch = {
                kind: "watch",
                id: this.nextId(),
                options: undefined,
                pattern: resolveVariables(configEntry, ctx),
                title: configEntry,
                workspaceName: undefined,
            };
            this.watchesById.set(watch.id, watch);
            return watch;
        } else if ("groupName" in configEntry) {
            return {
                kind: "group",
                groupName: configEntry.groupName,
                watches: configEntry.watches.map(x => this.toWatchEntry(x, ctx)),
            };
        } else {
            const watch: Watch = {
                kind: "watch",
                id: this.nextId(),
                ...configEntry,
                pattern: Array.isArray(configEntry.pattern)
                    ? configEntry.pattern.map(x => resolveVariables(x, ctx))
                    : resolveVariables(configEntry.pattern, ctx),
            };
            this.watchesById.set(watch.id, watch);
            return watch;
        }
    };

    get onChange(): vscode.Event<void> {
        return this._onChange.event;
    }

    private load() {
        this.watches.splice(0);
        this.watchesById.clear();
        this.seqId = 0;
        this.config = vscode.workspace.getConfiguration(configurationSection) as ConfigService["config"];
        const configWatches = this.config.watch;
        if (configWatches) {
            const ctx: VariableResolveContext = {
                env: process.env,
                home: os.homedir(),
                workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                allowBackslashAsPathSeparator: this.config.windows.allowBackslashAsPathSeparator,
            };
            for (const w of configWatches) {
                this.watches.push(this.toWatchEntry(w, ctx));
            }
        }
    }

    public get<K extends keyof ConfigTypeMap>(key: K): ConfigTypeMap[K] | undefined {
        return this.config.get(key);
    }

    public getWatches(): WatchEntry[] {
        return this.watches;
    }

    public getEffectiveWatchOptions(watchId: number): WatchOptions {
        // copy
        const resultOpts = { ...DefaulOptions };

        const globalOpts = this.config.options;

        if (globalOpts !== null) {
            Object.assign(resultOpts, globalOpts);
        }

        const watch = this.watchesById.get(watchId);
        if (watch?.options) {
            Object.assign(resultOpts, watch.options);
        }

        return resultOpts;
    }

    public getEffectiveFilterOptions(): FilterOptions {
        const resultOpts = { ...DefaultFilterOptions };
        const configFilter = this.config.filter;
        
        if (configFilter !== null) {
            Object.assign(resultOpts, configFilter);
        }

        // Apply in-memory overrides on top
        Object.assign(resultOpts, this._filterOverrides);

        return resultOpts;
    }

    public getEffectiveTailLines(): number {
        if (this._tailLinesOverride !== undefined) {
            return this._tailLinesOverride;
        }
        const fromConfig = this.config.get<number>("tailLines");
        if (fromConfig === undefined || fromConfig === null || fromConfig < 0) {
            return 0;
        }
        return fromConfig;
    }

    public async setFilterOverrides(updates: Partial<FilterOptions>): Promise<void> {
        Object.assign(this._filterOverrides, updates);

        if (hasWorkspace()) {
            const config = vscode.workspace.getConfiguration(configurationSection);
            const current = config.get<any>("filter") || {};
            Object.assign(current, updates);
            await config.update("filter", current, vscode.ConfigurationTarget.Workspace);
        } else {
            // No workspace: just fire change event for in-memory update
            this._onChange.fire();
        }
    }

    public async setTailLines(value: number): Promise<void> {
        this._tailLinesOverride = value;

        if (hasWorkspace()) {
            const config = vscode.workspace.getConfiguration(configurationSection);
            await config.update("tailLines", value, vscode.ConfigurationTarget.Workspace);
        } else {
            this._onChange.fire();
        }
    }

    public dispose(): void {
        this._onChange.dispose();
    }
}
