import { getPathImpl } from "../utils/util";
import type { Event } from "../types/vscodeTypes";

export enum LogLevel {
    trace = 0,
    debug = 1,
    info = 2,
    warn = 3,
    error = 4,
}

export interface WatchGroup {
    kind: "group";
    readonly groupName: string;
    readonly watches: ReadonlyArray<WatchEntry>;
}

export interface Watch {
    kind: "watch";
    readonly id: number;
    readonly title: string | undefined;
    readonly pattern: string | string[];
    readonly workspaceName: string | undefined;
    readonly options: Partial<WatchOptions> | undefined;
}

export type WatchEntry = WatchGroup | Watch;

export interface WatchOptions {
    readonly fileCheckInterval: number;
    readonly fileListInterval: number;
    readonly ignorePattern: string;
    readonly encoding: string | undefined | null;
}

export interface FilterOptions {
    readonly minLevel: "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE" | "ALL";
    readonly searchPattern: string | undefined;
    readonly cleanFormat: boolean;
    readonly excludePatterns: string[] | undefined;
    readonly includePatterns: string[] | undefined;
}

export function isFilterActive(opts: FilterOptions): boolean {
    return opts.minLevel !== "ALL" && opts.minLevel !== "TRACE"
        || !!opts.searchPattern
        || opts.cleanFormat
        || (!!opts.excludePatterns && opts.excludePatterns.length > 0)
        || (!!opts.includePatterns && opts.includePatterns.length > 0);
}

export interface ConfigTypeMap {
    options: Partial<WatchOptions>;
    windows: WindowsConfig;
    showStatusBarItemOnChange: boolean;
    tailLines: number;
    logLevel: keyof typeof LogLevel;
    followTailMode: "auto" | "manual";
    filter: Partial<FilterOptions>;
}

interface WindowsConfig {
    allowBackslashAsPathSeparator: boolean;
}

export interface IConfigService {
    get<K extends keyof ConfigTypeMap>(key: K): ConfigTypeMap[K] | undefined;
    getWatches(): WatchEntry[];
    getEffectiveWatchOptions(watchId: number): WatchOptions;
    getEffectiveFilterOptions(): FilterOptions;
    getEffectiveTailLines(): number;
    setFilterOverrides(updates: Partial<FilterOptions>): Promise<void>;
    setTailLines(value: number): Promise<void>;

    onChange: Event<void>;
}

export const DefaulOptions: Readonly<WatchOptions> = Object.freeze({
    fileCheckInterval: 500,
    fileListInterval: 2000,
    ignorePattern: "(node_modules|.git)",
    encoding: undefined,
});

export const DefaultFilterOptions: Readonly<FilterOptions> = Object.freeze({
    minLevel: "ALL",
    searchPattern: undefined,
    cleanFormat: false,
    excludePatterns: undefined,
    includePatterns: undefined,
});

export interface VariableResolveContext {
    home: string;
    env: { [key: string]: string | undefined };
    workspaceFolder: string | undefined;
    // only meaningful on windows
    allowBackslashAsPathSeparator: boolean;
}

export function resolveVariables(
    pattern: string,
    { env, home, workspaceFolder, allowBackslashAsPathSeparator }: VariableResolveContext,
): string {
    const path = getPathImpl();
    if (!allowBackslashAsPathSeparator && path.sep === "\\") {
        // normalize path separators
        home = home.split(path.sep).join(path.posix.sep);
        if (workspaceFolder) {
            workspaceFolder = workspaceFolder.split(path.sep).join(path.posix.sep);
        }
    }
    pattern = pattern.replace(/^(~|\$HOME)(?=\W|$)/, home);
    return pattern.replaceAll(/\$\{([^}]+)\}/g, (m: string, g1: string) => {
        switch (g1) {
            case "userHome":
                return home;
            case "workspaceFolder":
                if (workspaceFolder) {
                    return workspaceFolder;
                } else {
                    return m;
                }
            case "workspaceFolderBasename":
                if (workspaceFolder) {
                    return path.basename(workspaceFolder);
                } else {
                    return m;
                }
        }
        if (g1.startsWith("env:")) {
            const name = g1.slice("env:".length);
            const value = env[name];
            return value ?? m;
        }
        return m;
    });
}
