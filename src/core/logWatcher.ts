import * as fs from "node:fs";
import * as vscode from "vscode";
import type { WatchOptions } from "../types/config";
import { getInstance } from "../utils/container";
import { MultiPathMatcherWalker, SinglePathMatcherWalker, type FileInfo } from "../utils/fileSystem";
import type { FsWalker } from "../utils/fsWalker";
import type { Logger } from "../utils/logger";
import { toPathMatcher } from "../utils/mmUtil";
import { getWorkspaceDir, patternDescription } from "../utils/util";
import type { WatchForUri } from "../core/logUri";

interface GlobChange {
    readonly filename: string | undefined;
}

type IGlobWatcherConstructor = new (options: WatchOptions, watch: WatchForUri) => IGlobWatcher;

export interface IGlobWatcher extends vscode.Disposable {
    readonly onChange: vscode.Event<GlobChange>;
    LastFile(): string | undefined;
    startWatch(): Promise<void>;
}

function getWalker(watch: WatchForUri, ignorePattern: string | undefined): FsWalker {
    const cwd = getWorkspaceDir(vscode.workspace.workspaceFolders, watch.workspaceName);

    if (Array.isArray(watch.pattern)) {
        const pathMatchers = watch.pattern.map(pattern =>
            toPathMatcher(pattern, {
                cwd: cwd,
                nameIgnorePattern: ignorePattern,
            }),
        );
        return new MultiPathMatcherWalker(pathMatchers);
    } else {
        const pathMatcher = toPathMatcher(watch.pattern, {
            cwd: cwd,
            nameIgnorePattern: ignorePattern,
        });
        return new SinglePathMatcherWalker(pathMatcher);
    }
}

class SimpleGlobWatcher implements IGlobWatcher {
    private readonly logger: Logger;
    private readonly walker: FsWalker;
    private readonly patternDescription: string;

    private fileTimer: NodeJS.Timeout | undefined;
    private globTimer: NodeJS.Timeout | undefined;

    private readonly _onChange = new vscode.EventEmitter<GlobChange>();

    private lastFile: FileInfo | undefined;

    public get onChange(): vscode.Event<GlobChange> {
        return this._onChange.event;
    }

    public LastFile(): string | undefined {
        return this.lastFile?.fullPath;
    }

    constructor(
        private readonly options: WatchOptions,
        readonly watch: WatchForUri,
    ) {
        this.logger = getInstance("logger");
        this.walker = getWalker(watch, this.options.ignorePattern);
        this.patternDescription = patternDescription(watch.pattern);
    }

    public async startWatch(): Promise<void> {
        await this.globTick();
        await this.fileTick();
    }

    private readonly fileTick = async () => {
        if (this.lastFile) {
            try {
                const newStat = await fs.promises.stat(this.lastFile.fullPath);
                if (
                    newStat.mtime.getTime() !== this.lastFile.stats.mtime.getTime() ||
                    newStat.size !== this.lastFile.stats.size
                ) {
                    this._onChange.fire({
                        filename: this.lastFile.fullPath,
                    });
                }
            } catch (err) {
                // debug, because may have been removed
                this.logger.debug(err);
                this.lastFile = undefined;
                this._onChange.fire({
                    filename: undefined,
                });
            }
        }

        // oxlint-disable-next-line no-misused-promises
        this.fileTimer = setTimeout(this.fileTick, this.options.fileCheckInterval);
    };

    private readonly onError = (err: Error) => {
        // debug, because this can happen when trying to access
        // folders for which we don't have permissions,
        // and that should not be considered an error
        this.logger.debug(err);
    };

    private readonly globTick = async () => {
        let maxMTime = 0;
        let maxFI: FileInfo | undefined;

        this.logger.timeStart(this.patternDescription);

        await this.walker.walk({
            onFile: fi => {
                const mt = fi.stats.mtime.getTime();
                if (mt > maxMTime) {
                    maxMTime = mt;
                    maxFI = fi;
                }
            },
            onError: this.onError,
        });

        this.logger.timeEnd(this.patternDescription);

        if (maxFI) {
            let newLastFile = false;
            if (this.lastFile) {
                if (maxFI.fullPath !== this.lastFile.fullPath) {
                    newLastFile = true;
                }
            } else {
                newLastFile = true;
            }
            if (newLastFile) {
                this.lastFile = maxFI;
                this._onChange.fire({
                    filename: maxFI.fullPath,
                });
            }
        } else if (this.lastFile) {
            this.lastFile = undefined;
            this._onChange.fire({
                filename: undefined,
            });
        }

        // oxlint-disable-next-line no-misused-promises
        this.globTimer = setTimeout(this.globTick, this.options.fileListInterval);
    };

    public dispose(): void {
        if (this.fileTimer) {
            clearTimeout(this.fileTimer);
        }
        if (this.globTimer) {
            clearTimeout(this.globTimer);
        }
    }
}

export const SimpleGlobWatcherConstructable: IGlobWatcherConstructor = SimpleGlobWatcher;
