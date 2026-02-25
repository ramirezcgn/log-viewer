/**
 * Log Detail Panel
 * Bottom panel webview that shows parsed details of the selected log line.
 */

import * as vscode from "vscode";
import { LogViewerSchema } from "../core/logUri";
import { parseLogLine, LogLevel, type LogLine, getLogEntryRange, isLogEntryStart } from "../filters/logFilter";
import type { LogWatchProvider } from "../core/logProvider";
import { EventType } from "../core/logProvider";

export const LOG_DETAIL_VIEW_ID = "logviewerplus.logDetail";

export function registerLogDetailPanel(logProvider: LogWatchProvider, subs: vscode.Disposable[]): void {
    const provider = new LogDetailViewProvider(logProvider);

    // Track whether any log document tab is open and set context key
    function updateHasOpenLog(): void {
        const hasLog = vscode.window.tabGroups.all
            .flatMap(g => g.tabs)
            .some(tab => {
                const input = tab.input;
                return input instanceof vscode.TabInputText && input.uri.scheme === LogViewerSchema;
            });
        void vscode.commands.executeCommand("setContext", "logviewerplus.hasOpenLog", hasLog);
    }
    updateHasOpenLog();

    subs.push(
        vscode.window.registerWebviewViewProvider(LOG_DETAIL_VIEW_ID, provider),
        vscode.window.tabGroups.onDidChangeTabs(() => updateHasOpenLog()),
        logProvider.onChange(e => {
            if (e.type === EventType.ContentChange || e.type === EventType.FileChange) {
                const editor = vscode.window.activeTextEditor;
                if (editor?.document.uri.toString() === e.uri.toString()) {
                    provider.invalidate();
                    provider.updateLine(editor.document, editor.selection.active.line);
                }
            }
        }),
        vscode.window.onDidChangeTextEditorSelection(e => {
            const doc = e.textEditor.document;
            if (doc.uri.scheme !== LogViewerSchema) {
                return;
            }
            const line = e.selections[0]?.active.line;
            if (line === undefined) {
                return;
            }
            provider.updateLine(doc, line);
        }),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor?.document.uri.scheme === LogViewerSchema) {
                // Reveal the panel when switching to a log document
                void vscode.commands.executeCommand(`${LOG_DETAIL_VIEW_ID}.focus`);
            } else {
                provider.clear();
            }
        }),
    );
}

class LogDetailViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _lastLineNum = -1;
    private _lastEntryStart = -1;

    constructor(private readonly _logProvider: LogWatchProvider) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this._renderEmpty();

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage((msg: { type: string; text: string; direction?: string }) => {
            if (msg.type === "copy") {
                void vscode.env.clipboard.writeText(msg.text);
                void vscode.window.showInformationMessage("Copied to clipboard");
            } else if (msg.type === "navigate") {
                this._navigateLine(msg.direction === "prev" ? -1 : 1);
            }
        });

        // If a log document is already open, show current line
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.uri.scheme === LogViewerSchema) {
            const line = editor.selection.active.line;
            this.updateLine(editor.document, line);
        }
    }

    updateLine(doc: vscode.TextDocument, lineNum: number): void {
        if (!this._view) {
            return;
        }

        const watchState = this._logProvider.get(doc.uri);

        if (watchState?.lineMap && watchState.rawBytes) {
            const lineMap = watchState.lineMap;
            const rawText = new TextDecoder("utf-8").decode(watchState.rawBytes);
            const rawLines = rawText.split(/\r?\n/);
            let filteredEntryStart = lineNum;
            while (filteredEntryStart > 0) {
                const rawIdx = lineMap[filteredEntryStart];
                if (rawIdx !== undefined && isLogEntryStart(rawLines[rawIdx] ?? "")) {
                    break;
                }
                filteredEntryStart--;
            }
            if (filteredEntryStart === this._lastEntryStart) {
                return;
            }
            this._lastEntryStart = filteredEntryStart;
            this._lastLineNum = lineNum;
            const rawIdx = lineMap[filteredEntryStart];
            if (rawIdx === undefined || !rawLines[rawIdx]?.trim()) {
                this._renderEmpty();
                return;
            }
            const rawFirstLine = rawLines[rawIdx];
            const rawRange = getLogEntryRange(rawLines, rawIdx);
            const rawContinuations = rawLines.slice(rawRange.start + 1, rawRange.end + 1);
            const parsedRaw = parseLogLine(rawFirstLine);
            this._renderLine(parsedRaw, rawFirstLine, filteredEntryStart, rawContinuations);
            return;
        }

        // ── Normal mode ────────────────────────────────────────────────────────
        const allLines: string[] = [];
        for (let i = 0; i < doc.lineCount; i++) {
            allLines.push(doc.lineAt(i).text);
        }
        const range = getLogEntryRange(allLines, lineNum);

        // Deduplicate: if we're on the same entry, skip
        if (range.start === this._lastEntryStart) {
            return;
        }
        this._lastEntryStart = range.start;
        this._lastLineNum = lineNum;

        const entryLines = allLines.slice(range.start, range.end + 1);
        const firstLine = entryLines[0];

        if (!firstLine.trim()) {
            this._renderEmpty();
            return;
        }

        const continuationLines = entryLines.slice(1);
        const parsed = parseLogLine(firstLine);
        this._renderLine(parsed, firstLine, range.start, continuationLines);
    }

    clear(): void {
        this._lastLineNum = -1;
        this._lastEntryStart = -1;
        this._renderEmpty();
    }

    invalidate(): void {
        this._lastLineNum = -1;
        this._lastEntryStart = -1;
    }

    private _navigateLine(delta: number): void {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.uri.scheme !== LogViewerSchema) {
            return;
        }
        const doc = editor.document;

        const watchState = this._logProvider.get(doc.uri);

        let target: number;

        if (watchState?.lineMap && watchState.rawBytes) {
            const lineMap = watchState.lineMap;
            const rawText = new TextDecoder("utf-8").decode(watchState.rawBytes);
            const rawLines = rawText.split(/\r?\n/);

            if (delta > 0) {
                target = this._lastEntryStart + 1;
                while (target < doc.lineCount) {
                    const rawIdx = lineMap[target];
                    if (rawIdx !== undefined && isLogEntryStart(rawLines[rawIdx] ?? "")) {
                        break;
                    }
                    target++;
                }
            } else {
                target = this._lastEntryStart - 1;
                while (target >= 0) {
                    const rawIdx = lineMap[target];
                    if (rawIdx !== undefined && isLogEntryStart(rawLines[rawIdx] ?? "")) {
                        break;
                    }
                    target--;
                }
            }
        } else {
            // Normal mode
            const allLines: string[] = [];
            for (let i = 0; i < doc.lineCount; i++) {
                allLines.push(doc.lineAt(i).text);
            }

            const currentRange = getLogEntryRange(allLines, this._lastLineNum);

            if (delta > 0) {
                target = currentRange.end + 1;
                while (target < doc.lineCount && !allLines[target].trim()) {
                    target++;
                }
            } else {
                target = currentRange.start - 1;
                while (target >= 0 && !allLines[target].trim()) {
                    target--;
                }
                if (target >= 0) {
                    const prevRange = getLogEntryRange(allLines, target);
                    target = prevRange.start;
                }
            }
        }

        if (target < 0 || target >= doc.lineCount) {
            return;
        }
        const pos = new vscode.Position(target, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }

    private _renderEmpty(): void {
        if (!this._view) {
            return;
        }
        this._view.webview.html = this._buildHtml(
            `<p class="empty">Click on a log line to see its details</p>`,
        );
    }

    private _renderLine(parsed: LogLine | null, raw: string, lineNum: number, continuationLines: string[]): void {
        if (!this._view) {
            return;
        }

        const fullRaw = [raw, ...continuationLines].join("\n");
        const lineLabel = continuationLines.length > 0
            ? `Lines ${lineNum + 1}–${lineNum + 1 + continuationLines.length}`
            : `Line ${lineNum + 1}`;

        if (!parsed) {
            // Unparsed line — show raw content
            this._view.webview.html = this._buildHtml(`
                <div class="header">
                    <span class="line-num">${lineLabel}</span>
                    <span class="badge unparsed">UNPARSED</span>
                    <span class="nav-spacer"></span>
                    <button class="nav-btn" data-dir="prev" title="Previous entry (↑)">▲</button>
                    <button class="nav-btn" data-dir="next" title="Next entry (↓)">▼</button>
                </div>
                <div class="section">
                    <div class="label">Raw <button class="copy-btn" data-text="${escapeAttr(fullRaw)}" title="Copy">⧉</button></div>
                    <pre class="value">${escapeHtml(fullRaw)}</pre>
                </div>
            `);
            return;
        }

        const levelClass = levelToClass(parsed.level);
        const levelName = levelToName(parsed.level);
        const fullMessage = continuationLines.length > 0
            ? parsed.message + "\n" + continuationLines.join("\n")
            : parsed.message;
        const formattedMessage = tryFormatJson(fullMessage);

        this._view.webview.html = this._buildHtml(`
            <div class="header">
                <span class="line-num">${lineLabel}</span>
                <span class="badge ${levelClass}">${escapeHtml(levelName)}</span>
                <span class="nav-spacer"></span>
                <button class="nav-btn" data-dir="prev" title="Previous entry (↑)">▲</button>
                <button class="nav-btn" data-dir="next" title="Next entry (↓)">▼</button>
            </div>
            ${parsed.timestamp ? `
            <div class="section">
                <div class="label">Timestamp <button class="copy-btn" data-text="${escapeAttr(parsed.timestamp)}" title="Copy">⧉</button></div>
                <div class="value">${escapeHtml(parsed.timestamp)}</div>
            </div>` : ""}
            ${parsed.source ? `
            <div class="section">
                <div class="label">Source <button class="copy-btn" data-text="${escapeAttr(parsed.source)}" title="Copy">⧉</button></div>
                <div class="value source">${escapeHtml(parsed.source)}</div>
            </div>` : ""}
            <div class="section">
                <div class="label">Message${continuationLines.length > 0 ? ` <span class="multi-badge">${continuationLines.length + 1} lines</span>` : ""} <button class="copy-btn" data-text="${escapeAttr(fullMessage)}" title="Copy">⧉</button></div>
                <pre class="value message">${formattedMessage}</pre>
            </div>
        `);
    }

    private _buildHtml(body: string): string {
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
    body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background: var(--vscode-panel-background, var(--vscode-editor-background));
        margin: 0;
        padding: 8px 12px;
        line-height: 1.5;
    }
    .empty {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
    }
    .header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border));
    }
    .line-num {
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
    }
    .badge {
        padding: 1px 8px;
        border-radius: 3px;
        font-weight: bold;
        font-size: 0.85em;
        text-transform: uppercase;
    }
    .badge.error   { background: #f4474733; color: #f44747; }
    .badge.warn    { background: #cca70033; color: #cca700; }
    .badge.info    { background: #3794ff33; color: #3794ff; }
    .badge.debug   { background: #89d18533; color: #89d185; }
    .badge.trace   { background: #88888833; color: #888888; }
    .badge.unparsed { background: #88888833; color: #888888; }
    .multi-badge {
        font-size: 0.8em;
        padding: 1px 5px;
        border-radius: 3px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        margin-left: 4px;
    }
    .section {
        margin-bottom: 6px;
    }
    .label {
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 2px;
    }
    .value {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-all;
    }
    .value.source {
        color: #4EC9B0;
    }
    .value.message {
        font-family: var(--vscode-editor-font-family);
        font-size: var(--vscode-editor-font-size);
    }
    .copy-btn {
        background: none;
        border: 1px solid var(--vscode-button-secondaryBackground, #444);
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        padding: 0 4px;
        margin-left: 6px;
        border-radius: 3px;
        font-size: 0.8em;
        vertical-align: middle;
        line-height: 1.4;
    }
    .copy-btn:hover {
        background: var(--vscode-button-secondaryHoverBackground, #555);
        color: var(--vscode-foreground);
    }
    .nav-spacer {
        flex: 1;
    }
    .nav-btn {
        background: none;
        border: 1px solid var(--vscode-button-secondaryBackground, #444);
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        padding: 1px 6px;
        border-radius: 3px;
        font-size: 0.85em;
        line-height: 1.2;
    }
    .nav-btn:hover {
        background: var(--vscode-button-secondaryHoverBackground, #555);
        color: var(--vscode-foreground);
    }
</style>
</head>
<body>${body}
<script>
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.copy-btn');
        if (copyBtn) {
            vscode.postMessage({ type: 'copy', text: copyBtn.dataset.text });
            return;
        }
        const navBtn = e.target.closest('.nav-btn');
        if (navBtn) {
            vscode.postMessage({ type: 'navigate', direction: navBtn.dataset.dir });
        }
    });
    // Keyboard navigation: arrow keys
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            vscode.postMessage({ type: 'navigate', direction: 'prev' });
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            vscode.postMessage({ type: 'navigate', direction: 'next' });
        }
    });
</script>
</body>
</html>`;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function escapeAttr(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function levelToClass(level: LogLevel): string {
    switch (level) {
        case LogLevel.ERROR: return "error";
        case LogLevel.WARN:  return "warn";
        case LogLevel.INFO:  return "info";
        case LogLevel.DEBUG: return "debug";
        case LogLevel.TRACE: return "trace";
        default:             return "";
    }
}

function levelToName(level: LogLevel): string {
    switch (level) {
        case LogLevel.ERROR: return "ERROR";
        case LogLevel.WARN:  return "WARN";
        case LogLevel.INFO:  return "INFO";
        case LogLevel.DEBUG: return "DEBUG";
        case LogLevel.TRACE: return "TRACE";
        default:             return "UNKNOWN";
    }
}

/**
 * If the message looks like JSON, pretty-print it. Otherwise return escaped HTML.
 */
function tryFormatJson(message: string): string {
    const trimmed = message.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
            const obj = JSON.parse(trimmed);
            return escapeHtml(JSON.stringify(obj, null, 2));
        } catch {
            // Not valid JSON
        }
    }
    return escapeHtml(message);
}
