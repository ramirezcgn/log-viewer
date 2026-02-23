import * as vscode from "vscode";
import { getPathImpl } from "../utils/util";

export interface WatchForUri {
    readonly id: number;
    readonly pattern: string | string[];
    readonly title?: string;
    readonly workspaceName: string | undefined;
}

export const LogViewerSchema = "log-viewer-plus";
const LogViewerAuthority = "logviewerplus";

const BaseUri = vscode.Uri.parse(`${LogViewerSchema}://${LogViewerAuthority}`);

export function toLogUri(w: WatchForUri): vscode.Uri {
    //the only way I found to control the title of the tab is with the path of the uri
    //so if we have a title use it as the path of the uri
    const firstPattern = Array.isArray(w.pattern) ? w.pattern[0] : w.pattern;
    let uriPath = w.title ?? firstPattern;

    const path = getPathImpl();
    //add extension so that is asociated with appropiate syntax highlighting
    const ext = path.extname(firstPattern);
    if (ext && ext !== "." && !ext.includes("*")) {
        if (!uriPath.endsWith(ext)) {
            uriPath = uriPath + ext;
        }
    } else {
        //use highlighting for "*.log" if we cannot deduce extension from pattern
        uriPath = uriPath + ".log";
    }

    // replace `/` to avoid issues with normalization performed by `vscode.FileSystemProvider`
    uriPath = "/" + uriPath.replaceAll("/", ">");

    const json = JSON.stringify(w);
    return BaseUri.with({
        path: uriPath,
        query: json,
    });
}

export function fromLogUri(logUri: vscode.Uri): WatchForUri {
    const w = JSON.parse(logUri.query) as WatchForUri;
    return w;
}
