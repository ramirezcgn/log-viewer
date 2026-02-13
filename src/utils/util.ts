import type { WorkspaceFolder } from "../types/vscodeTypes";
import * as path from "node:path";

export function assertNever(x: never): never {
    // oxlint-disable-next-line restrict-template-expressions
    throw new Error(`${x} is not never`);
}

export function getWorkspaceDir(
    // pass as parameter for easier testing
    workspaceFolders: readonly WorkspaceFolder[] | undefined,
    workspaceName: string | undefined,
): string | undefined {
    if (workspaceFolders !== undefined && workspaceFolders.length > 0) {
        let workspaceFolder = workspaceFolders[0];
        if (workspaceName) {
            const wf = workspaceFolders.find(x => x.name === workspaceName);
            if (wf) {
                workspaceFolder = wf;
            }
        }
        if (workspaceFolder) {
            return workspaceFolder.uri.fsPath;
        }
    }
}

let _devEnv = false;
export function setDevEnv(val: boolean): void {
    _devEnv = val;
}

export function isDevEnv(): boolean {
    return _devEnv;
}

export function patternDescription(pattern: string | string[]): string {
    if (Array.isArray(pattern)) {
        return pattern.join(",");
    } else {
        return pattern;
    }
}

let _pathImpl: path.PlatformPath | undefined;
export function getPathImpl(): path.PlatformPath {
    return _pathImpl ?? path;
}

