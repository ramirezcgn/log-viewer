/**
 * Log Bookmarks
 * Toggle bookmarks on log lines, navigate between them, gutter decorations.
 */

import * as vscode from "vscode";
import { LogViewerSchema } from "../core/logUri";

// ── Gutter decoration ────────────────────────────────────────────────────

const bookmarkDecoration = vscode.window.createTextEditorDecorationType({
    gutterIconPath: new vscode.ThemeIcon("bookmark").id,
    gutterIconSize: "contain",
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    isWholeLine: true,
    overviewRulerColor: "#FFD700",
    overviewRulerLane: vscode.OverviewRulerLane.Center,
});

// ── State ────────────────────────────────────────────────────────────────

/** Map<uri.toString(), Set<lineNumber>> */
const bookmarks = new Map<string, Set<number>>();

function getBookmarkSet(uri: vscode.Uri): Set<number> {
    const key = uri.toString();
    let set = bookmarks.get(key);
    if (!set) {
        set = new Set();
        bookmarks.set(key, set);
    }
    return set;
}

// ── Decoration update ────────────────────────────────────────────────────

function refreshDecorations(editor: vscode.TextEditor): void {
    if (editor.document.uri.scheme !== LogViewerSchema) {
        return;
    }
    const set = bookmarks.get(editor.document.uri.toString());
    if (!set || set.size === 0) {
        editor.setDecorations(bookmarkDecoration, []);
        return;
    }

    const ranges: vscode.DecorationOptions[] = [];
    for (const line of set) {
        if (line < editor.document.lineCount) {
            ranges.push({ range: editor.document.lineAt(line).range });
        }
    }
    editor.setDecorations(bookmarkDecoration, ranges);
}

// ── Commands ─────────────────────────────────────────────────────────────

function toggleBookmark(editor: vscode.TextEditor): void {
    if (editor.document.uri.scheme !== LogViewerSchema) {
        return;
    }
    const line = editor.selection.active.line;
    const set = getBookmarkSet(editor.document.uri);

    if (set.has(line)) {
        set.delete(line);
    } else {
        set.add(line);
    }
    refreshDecorations(editor);
    updateContext(editor);
}

function clearBookmarks(editor: vscode.TextEditor): void {
    const key = editor.document.uri.toString();
    bookmarks.delete(key);
    refreshDecorations(editor);
    updateContext(editor);
}

function goToNextBookmark(editor: vscode.TextEditor): void {
    const set = bookmarks.get(editor.document.uri.toString());
    if (!set || set.size === 0) {
        vscode.window.showInformationMessage("No bookmarks set");
        return;
    }
    const currentLine = editor.selection.active.line;
    const sorted = [...set].sort((a, b) => a - b);
    const next = sorted.find(l => l > currentLine) ?? sorted[0];
    revealLine(editor, next);
}

function goToPrevBookmark(editor: vscode.TextEditor): void {
    const set = bookmarks.get(editor.document.uri.toString());
    if (!set || set.size === 0) {
        vscode.window.showInformationMessage("No bookmarks set");
        return;
    }
    const currentLine = editor.selection.active.line;
    const sorted = [...set].sort((a, b) => a - b);
    const reversed = [...sorted].reverse();
    const prev = reversed.find(l => l < currentLine) ?? reversed[0];
    revealLine(editor, prev);
}

function revealLine(editor: vscode.TextEditor, line: number): void {
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

function updateContext(editor: vscode.TextEditor): void {
    const set = bookmarks.get(editor.document.uri.toString());
    const hasBookmarks = !!set && set.size > 0;
    void vscode.commands.executeCommand("setContext", "logviewerplus.hasBookmarks", hasBookmarks);
}

// ── Registration ─────────────────────────────────────────────────────────

export function registerBookmarks(subs: vscode.Disposable[]): void {
    subs.push(
        bookmarkDecoration,
        vscode.commands.registerCommand("logviewerplus.toggleBookmark", () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                toggleBookmark(editor);
            }
        }),
        vscode.commands.registerCommand("logviewerplus.nextBookmark", () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                goToNextBookmark(editor);
            }
        }),
        vscode.commands.registerCommand("logviewerplus.prevBookmark", () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                goToPrevBookmark(editor);
            }
        }),
        vscode.commands.registerCommand("logviewerplus.clearBookmarks", () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                clearBookmarks(editor);
            }
        }),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                refreshDecorations(editor);
                updateContext(editor);
            }
        }),
        // Refresh when document content changes (log reload)
        vscode.workspace.onDidChangeTextDocument(e => {
            const editor = vscode.window.activeTextEditor;
            if (e.document === editor?.document) {
                refreshDecorations(editor);
            }
        }),
    );
}
