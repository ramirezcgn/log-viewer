import * as fs from "node:fs";
import type { FsWalker, FsWalkerSubscription } from "../utils/fsWalker";
import { myIsMatch, type PathMatcher } from "../utils/mmUtil";
import type { BeforeGlobstarParts } from "../utils/pathPattern";
import { getPathImpl } from "../utils/util";

export interface FileInfo {
    readonly fullPath: string;
    readonly stats: fs.Stats;
}

function lsPattern(
    pathMatcher: PathMatcher,
    onFile: (fi: FileInfo) => void,
    onError?: (err: NodeJS.ErrnoException) => void,
): Promise<void> {
    const onErr = onError ?? (() => {});
    const path = getPathImpl();

    return new Promise<void>(resolve => {
        let pending = 0;

        function decPending(): void {
            pending--;
            if (pending === 0) {
                resolve();
            }
        }

        const handleUnkown = (fullPath: string, patternParts: BeforeGlobstarParts | undefined) => {
            pending += 1;
            fs.stat(fullPath, (err, stats) => {
                if (err) {
                    onErr(err);
                } else if (stats.isDirectory()) {
                    handleDir(fullPath, patternParts);
                } else {
                    handleFile(fullPath, stats);
                }
                decPending();
            });
        };

        const handleDir = (fullPath: string, patternParts: BeforeGlobstarParts | undefined) => {
            pending += 1;
            fs.readdir(fullPath, { withFileTypes: true }, (err, entries) => {
                if (err) {
                    onErr(err);
                } else {
                    for (const entry of entries) {
                        handleEntry(fullPath, entry, patternParts);
                    }
                }
                decPending();
            });
        };

        const handleEntry = (
            dirPath: string,
            entry: fs.Dirent,
            patternParts: BeforeGlobstarParts | undefined,
        ) => {
            if (pathMatcher.nameIgnoreMatcher(entry.name) || (patternParts && !myIsMatch(entry.name, patternParts.head))) {
                return;
            }
            const remainingPatternParts = patternParts?.tail;
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                handleDir(fullPath, remainingPatternParts);
            } else if (entry.isSymbolicLink()) {
                handleUnkown(fullPath, remainingPatternParts);
            } else {
                handleFile(fullPath);
            }
        };

        const handleFile = (fullPath: string, stats?: fs.Stats) => {
            if (!pathMatcher.fullPathMatcher(fullPath)) {
                return;
            }
            if (stats === undefined) {
                pending += 1;
                fs.stat(fullPath, (err, stats) => {
                    if (err) {
                        onErr(err);
                    } else {
                        onFile({
                            fullPath,
                            stats,
                        });
                    }
                    decPending();
                });
            } else {
                onFile({
                    fullPath,
                    stats,
                });
            }
        };

        handleUnkown(pathMatcher.basePath, pathMatcher.patterns);
    });
}

export class SinglePathMatcherWalker implements FsWalker {
    constructor(private readonly pathMatcher: PathMatcher) {}
    public walk(sub: FsWalkerSubscription): Promise<void> {
        return lsPattern(this.pathMatcher, sub.onFile, sub.onError);
    }
}

export class MultiPathMatcherWalker implements FsWalker {
    constructor(private readonly pathMatchers: PathMatcher[]) {}
    public async walk(sub: FsWalkerSubscription): Promise<void> {
        await Promise.all(
            this.pathMatchers.map(pathMatcher => lsPattern(pathMatcher, sub.onFile, sub.onError)),
        );
    }
}
