import * as fs from "node:fs";
import type { DecoderStream } from "iconv-lite";
import * as vscode from "vscode";
import {
    LogLevel,
    filterLogContent,
    getLogStats,
    type LogFilterOptions,
    type LogStats,
} from "../filters/logFilter";
import type { WatchEntry } from "../types/config";
import { getInstance } from "../utils/container";
import type { Logger } from "../utils/logger";
import { assertNever, patternDescription } from "../utils/util";
import type { ConfigService } from "../types/configService";
import { SimpleGlobWatcherConstructable as GlobWatcher, type IGlobWatcher } from "../core/logWatcher";
import { fromLogUri, LogViewerSchema, toLogUri, type WatchForUri } from "../core/logUri";

function getTailLines(configSvc: ConfigService): number {
    return configSvc.getEffectiveTailLines();
}

const utf8Encoder = new TextEncoder();

function tailByLines(content: string, maxLines: number): string {
    if (maxLines <= 0) {
        return content;
    }
    const lines = content.split("\n");
    if (lines.length <= maxLines) {
        return content;
    }
    return lines.slice(-maxLines).join("\n");
}

async function readFileContent(
    file: string,
    decoder: DecoderStream | undefined,
    offset: number | undefined,
    configSvc: ConfigService,
): Promise<Uint8Array> {
    if (!offset || offset < 0) {
        offset = 0;
    }
    const fd = await fs.promises.open(file, "r");
    try {
        const stat = await fd.stat();
        const partSize = stat.size - offset;
        if (partSize <= 0) {
            return new Uint8Array();
        }

        const buffer = Buffer.alloc(partSize);
        const res = await fd.read(buffer, 0, partSize, offset);
        const buff = res.buffer.subarray(0, res.bytesRead);

        let text: string;
        if (decoder) {
            const decodeRes = decoder.write(buff);
            const decodeTrail = decoder.end();
            text = decodeTrail ? decodeRes + decodeTrail : decodeRes;
        } else {
            text = new TextDecoder("utf-8").decode(buff);
        }

        // Apply tail lines limit
        const maxLines = getTailLines(configSvc);
        text = tailByLines(text, maxLines);

        return utf8Encoder.encode(text);
    } finally {
        await fd.close();
    }
}

function convertFilterOptions(configSvc: ConfigService): LogFilterOptions {
    const filterConfig = configSvc.getEffectiveFilterOptions();
    
    let minLevel = LogLevel.TRACE;
    switch (filterConfig.minLevel) {
        case "ERROR":
            minLevel = LogLevel.ERROR;
            break;
        case "WARN":
            minLevel = LogLevel.WARN;
            break;
        case "INFO":
            minLevel = LogLevel.INFO;
            break;
        case "DEBUG":
            minLevel = LogLevel.DEBUG;
            break;
        case "TRACE":
        case "ALL":
            minLevel = LogLevel.TRACE;
            break;
    }

    return {
        minLevel,
        searchPattern: filterConfig.searchPattern,
        cleanFormat: filterConfig.cleanFormat,
        excludePatterns: filterConfig.excludePatterns,
        includePatterns: filterConfig.includePatterns,
    };
}

function applyFilters(content: Uint8Array, configSvc: ConfigService): Uint8Array {
    const filterOptions = convertFilterOptions(configSvc);

    // Convert Uint8Array to string
    const textDecoder = new TextDecoder("utf-8");
    const contentStr = textDecoder.decode(content);

    // Apply filters
    const filtered = filterLogContent(contentStr, filterOptions);

    // Convert back to Uint8Array
    return utf8Encoder.encode(filtered);
}

const _decoders: { [encoding: string]: DecoderStream | undefined } = {};
function getDecoder(encoding: string | undefined | null): DecoderStream | undefined {
    if (!encoding) {
        return;
    }    
    let decoder = _decoders[encoding];
    if (decoder) {
        // clear internal buffer
        decoder.end();
        return decoder;
    }
    try {
         
        decoder = (require("iconv-lite") as typeof import("iconv-lite")).getDecoder(encoding);
        _decoders[encoding] = decoder;
        return decoder;
    } catch (error) {
        getInstance("logger").error(error);
        return;
    }
}

function uint8ArrayEquals(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
    if (!a || !b) {
        return a === b;
    }
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

interface WatchStateInternal {
    // undefined when stopped
    watcher: IGlobWatcher | undefined;
    readonly decoder: DecoderStream | undefined;
    lastFileName: string | undefined;
    offset: number | undefined;
    bytes: Uint8Array | undefined;
    rawBytes: Uint8Array | undefined;
    createdOn: Date;
    lastChangedOn: Date;
}

export interface WatchState {
    readonly running: boolean;
    readonly uri: vscode.Uri;
    readonly lastFileName: string | undefined;
    readonly bytes: Uint8Array | undefined;
    readonly rawBytes: Uint8Array | undefined;
    readonly createdOn: Date;
    readonly lastChangedOn: Date;
}

function createWatchState(uri: vscode.Uri, w: WatchStateInternal): WatchState {
    return {
        running: !!w.watcher,
        bytes: w.bytes,
        rawBytes: w.rawBytes,
        createdOn: w.createdOn,
        lastChangedOn: w.lastChangedOn,
        lastFileName: w.lastFileName,
        uri,
    };
}

export const enum EventType {
    Start = 0,
    ContentChange = 1,
    FileChange = 2,
    Stop = 3,
}

type WatchEvent = {
    readonly type: EventType;
    readonly uri: vscode.Uri;
};

export class LogWatchProvider implements vscode.Disposable {
    private readonly _onChange = new vscode.EventEmitter<WatchEvent>();
    private readonly _subs: vscode.Disposable[] = [this._onChange];
    private readonly _watchedUris: Map<string, WatchStateInternal> = new Map<string, WatchStateInternal>();

    constructor(
        private readonly configSvc: ConfigService,
        private readonly logger: Logger,
    ) {
        this._subs.push(
            configSvc.onChange(() => {
                this.checkForOrphanWatches();
                this.refreshAllWatches();
            }),
        );
    }

    private refreshAllWatches(): void {
        for (const [uriStr, state] of this._watchedUris.entries()) {
            if (state.watcher && state.lastFileName) {
                void this.checkChange(vscode.Uri.parse(uriStr), state, state.lastFileName);
            }
        }
    }

    public isWatching(uri: vscode.Uri): boolean {
        const state = this._watchedUris.get(uri.toString());
        return !!state?.watcher;
    }

    public get(uri: vscode.Uri): WatchState | undefined {
        const state = this._watchedUris.get(uri.toString());
        if (!state) {
            return;
        }
        return createWatchState(uri, state);
    }

    public getStats(uri: vscode.Uri): LogStats | undefined {
        const state = this._watchedUris.get(uri.toString());
        if (!state?.rawBytes) {
            return;
        }
        const textDecoder = new TextDecoder("utf-8");
        return getLogStats(textDecoder.decode(state.rawBytes));
    }

    public async clearContents(uri: vscode.Uri): Promise<void> {
        const state = this._watchedUris.get(uri.toString());
        if (state?.watcher && state.lastFileName) {
            const stat = await fs.promises.stat(state.lastFileName);
            state.offset = stat.size;
            await this.checkChange(uri, state, state.lastFileName);
        }
    }

    public async restoreContents(uri: vscode.Uri): Promise<void> {
        const state = this._watchedUris.get(uri.toString());
        if (state?.watcher && state.lastFileName) {
            state.offset = undefined;
            await this.checkChange(uri, state, state.lastFileName);
        }
    }

    public async startWatch(uri: vscode.Uri, startIfStopped: boolean): Promise<WatchState> {
        const uriStr = uri.toString();
        const foundState = this._watchedUris.get(uriStr);
        if (foundState && (!startIfStopped || foundState.watcher)) {
            return createWatchState(uri, foundState);
        }
        const w = fromLogUri(uri);
        const options = this.configSvc.getEffectiveWatchOptions(w.id);
        const now = new Date();
        const newState = {
            watcher: new GlobWatcher(options, w),
            decoder: getDecoder(options.encoding),
            createdOn: now,
            lastChangedOn: now,
            lastFileName: undefined,
            offset: undefined,
            bytes: undefined,
            rawBytes: undefined,
        } satisfies WatchStateInternal;
        newState.watcher.onChange(e => {
            void this.checkChange(uri, newState, e.filename);
        });
        this._watchedUris.set(uriStr, newState);

        this.logger.info(`Starting watch: "${watchDescription(w)}"`);
        this._onChange.fire({ uri, type: EventType.Start });
        await newState.watcher.startWatch();
        return createWatchState(uri, newState);
    }

    private async checkChange(
        uri: vscode.Uri,
        _state: WatchStateInternal,
        filename: string | undefined,
    ): Promise<boolean> {
        // otherwise assigning to state below triggers require-atomic-updates eslint rule
        const state = _state;

        let newRawBytes: Uint8Array | undefined =
            filename
                ? await readFileContent(filename, state.decoder, state.offset, this.configSvc)
                : undefined;

        // Apply filters to the content
        const newBytes = newRawBytes ? applyFilters(newRawBytes, this.configSvc) : undefined;

        // check if filename changed
        let changeType: EventType.ContentChange | EventType.FileChange | null = null;
        if (state.lastFileName !== filename) {
            state.lastFileName = filename;
            state.offset = undefined;
            changeType = EventType.FileChange;
        }

        // check if content changed
        if (!uint8ArrayEquals(state.bytes, newBytes)) {
            state.rawBytes = newRawBytes;
            state.bytes = newBytes;
            changeType ??= EventType.ContentChange;
        }

        if (changeType !== null) {
            state.lastChangedOn = new Date();
            this.logger.debug(() => {
                const w = fromLogUri(uri);
                let msg = `Change for "${watchDescription(w)}"`;
                if (filename) {
                    msg += ` on ${filename}`;
                }
                return msg;
            });
            this._onChange.fire({
                uri: uri,
                type: changeType,
            });
        }

        return changeType !== null;
    }

    get onChange(): vscode.Event<WatchEvent> {
        return this._onChange.event;
    }

    private didStopWatch(uri: vscode.Uri) {
        this._onChange.fire({ uri, type: EventType.Stop });
        this.logger.info(() => {
            const w = fromLogUri(uri);
            return `Stopping watch: "${watchDescription(w)}"`;
        });
    }

    public stopWatch(uri: vscode.Uri): void {
        if (!uri) {
            return;
        }
        const uriStr = uri.toString();
        const state = this._watchedUris.get(uriStr);
        if (state?.watcher) {
            state.watcher.dispose();
            state.watcher = undefined;
            this.didStopWatch(uri);
        }
    }

    public stopAllWatches(): void {
        for (const [uriStr, state] of this._watchedUris.entries()) {
            if (state.watcher) {
                state.watcher.dispose();
                state.watcher = undefined;
                this.didStopWatch(vscode.Uri.parse(uriStr));
            }
        }
    }

    private checkForOrphanWatches() {
        // remove watches whose config has been changed or removed
        const newWatchUriStrs = new Set<string>();
        function collectWatches(ws: readonly WatchEntry[]) {
            for (const w of ws) {
                switch (w.kind) {
                    case "watch": {
                        const uri = toLogUri(w);
                        newWatchUriStrs.add(uri.toString());
                        break;
                    }
                    case "group": {
                        collectWatches(w.watches);
                        break;
                    }
                    default:
                        assertNever(w);
                }
            }
        }
        collectWatches(this.configSvc.getWatches());

        for (const [uriStr, state] of this._watchedUris.entries()) {
            if (!newWatchUriStrs.has(uriStr)) {
                this._watchedUris.delete(uriStr);
                if (state.watcher) {
                    state.watcher.dispose();
                    state.watcher = undefined;
                    this.didStopWatch(vscode.Uri.parse(uriStr));
                }
            }
        }
    }

    public dispose(): void {
        this.stopAllWatches();
        for (const sub of this._subs) {
            sub.dispose();
        }
        this._watchedUris.clear();
    }
}

function watchDescription(w: WatchForUri): string {
    return w.title ?? patternDescription(w.pattern);
}

const NoMatchingFileMsgBytes: Uint8Array = new TextEncoder().encode("no matching file found");

const EmptyDisposable: vscode.Disposable = { dispose: () => {} };

class LogViewerFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
    private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

    private readonly _subs: vscode.Disposable[] = [this._onDidChangeFile];

    constructor(
        private readonly logger: Logger,
        private readonly logProvider: LogWatchProvider,
    ) {
        this._subs.push(
            logProvider.onChange(e => {
                if (e.type !== EventType.Stop) {
                    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri: e.uri }]);
                }
            }),
        );
    }

    get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
        return this._onDidChangeFile.event;
    }

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        return EmptyDisposable;
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const existing = this.logProvider.get(uri);
        if (existing) {
            return {
                type: vscode.FileType.File,
                ctime: existing.createdOn.getTime(),
                mtime: existing.lastChangedOn.getTime(),
                size: (existing.bytes ?? NoMatchingFileMsgBytes).length,
            };
        }
        const now = Date.now();
        return {
            type: vscode.FileType.File,
            ctime: now,
            mtime: now,
            size: 0,
        };
    }

    readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
        throw new Error("Method not supported.");
    }

    createDirectory(_uri: vscode.Uri): void {
        throw new Error("Method not supported.");
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        // If already watching, return current content immediately
        const existing = this.logProvider.get(uri);
        if (existing) {
            return existing.bytes ?? NoMatchingFileMsgBytes;
        }
        // Otherwise start watch in background and return placeholder
        // This prevents VS Code's tab restoration from blocking/canceling
        void this.logProvider.startWatch(uri, true).catch(err => {
            this.logger.error(`Failed to start watch for restored tab: ${err}`);
        });
        return NoMatchingFileMsgBytes;
    }

    writeFile(
        _uri: vscode.Uri,
        _content: Uint8Array,
        _options: { create: boolean; overwrite: boolean },
    ): void | Thenable<void> {
        throw new Error("Method not supported.");
    }

    delete(_uri: vscode.Uri, _options: { recursive: boolean }): void | Thenable<void> {
        throw new Error("Method not supported.");
    }

    rename(
        _oldUri: vscode.Uri,
        _newUri: vscode.Uri,
        _options: { overwrite: boolean },
    ): void | Thenable<void> {
        throw new Error("Method not supported.");
    }

    dispose(): void {
        for (const sub of this._subs) {
            sub.dispose();
        }
    }
}

export function registerLogWatchProvider(
    subs: vscode.Disposable[],
    configSvc: ConfigService,
    logger: Logger,
): LogWatchProvider {
    const logProvider = new LogWatchProvider(configSvc, logger);

    const logViewerFileSystemProvider = new LogViewerFileSystemProvider(logger, logProvider);

    subs.push(
        logProvider,
        logViewerFileSystemProvider,
        vscode.workspace.registerFileSystemProvider(LogViewerSchema, logViewerFileSystemProvider, {
            isReadonly: true,
        }),
        vscode.workspace.onDidCloseTextDocument(doc => {
            if (doc.uri.scheme === LogViewerSchema) {
                const uri = doc.uri;
                // Debounce: check after a short delay whether the document was reopened
                // to avoid killing a watcher that was just re-started
                setTimeout(() => {
                    const stillOpen = vscode.window.tabGroups.all
                        .flatMap(g => g.tabs)
                        .some(tab => {
                            const input = tab.input;
                            return input instanceof vscode.TabInputText
                                && input.uri.toString() === uri.toString();
                        });
                    if (!stillOpen) {
                        logProvider.stopWatch(uri);
                    }
                }, 500);
            }
        }),
    );

    return logProvider;
}
