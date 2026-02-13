import type { FileInfo } from "../utils/fileSystem";

export interface FsWalkerSubscription {
    onFile: (fi: FileInfo) => void;
    onError: (err: NodeJS.ErrnoException) => void;
}

export interface FsWalker {
    walk(sub: FsWalkerSubscription): Promise<void>;
}
