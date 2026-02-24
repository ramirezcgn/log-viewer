/**
 * Log Navigation
 * Navigate between errors, warnings, and search matches in log documents.
 */

import * as vscode from "vscode";
import { LogViewerSchema } from "../core/logUri";
import type { IConfigService } from "../types/config";

// ── Level patterns (reused from logDecorations) ──────────────────────────

const errorRegex = /\b(ERROR|FATAL)\b|\*(ERROR|FATAL)\*|\[(ERROR|FATAL)\]/i;
const warnRegex = /\bWARN(?:ING)?\b|\*WARN(?:ING)?\*|\[WARN(?:ING)?\]/i;

// ── Search highlight decoration ──────────────────────────────────────────

const searchHighlightDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    borderColor: new vscode.ThemeColor("editor.findMatchHighlightBorder"),
    borderWidth: "1px",
    borderStyle: "solid",
});

let currentSearchPattern: string | undefined;

export function updateSearchHighlight(editor: vscode.TextEditor, pattern: string | undefined): void {
    currentSearchPattern = pattern;
    applySearchHighlight(editor);
}

function applySearchHighlight(editor: vscode.TextEditor): void {
    if (editor.document.uri.scheme !== LogViewerSchema) {
        return;
    }

    if (!currentSearchPattern) {
        editor.setDecorations(searchHighlightDecoration, []);
        return;
    }

    const text = editor.document.getText();
    const ranges: vscode.DecorationOptions[] = [];

    try {
        // Try as regex first, fall back to literal
        let regex: RegExp;
        try {
            regex = new RegExp(currentSearchPattern, "gi");
        } catch {
            regex = new RegExp(escapeRegex(currentSearchPattern), "gi");
        }

        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            if (match[0].length === 0) {
                regex.lastIndex++;
                continue;
            }
            const startPos = editor.document.positionAt(match.index);
            const endPos = editor.document.positionAt(match.index + match[0].length);
            ranges.push({ range: new vscode.Range(startPos, endPos) });

            // Safety limit
            if (ranges.length > 10000) {
                break;
            }
        }
    } catch {
        // Invalid pattern — clear highlights
    }

    editor.setDecorations(searchHighlightDecoration, ranges);
}

// ── Navigation commands ──────────────────────────────────────────────────

function goToNextMatch(editor: vscode.TextEditor, regex: RegExp, label: string): void {
    if (editor.document.uri.scheme !== LogViewerSchema) {
        return;
    }

    const doc = editor.document;
    const currentLine = editor.selection.active.line;

    // Search forward from current line
    for (let i = currentLine + 1; i < doc.lineCount; i++) {
        if (regex.test(doc.lineAt(i).text)) {
            revealLine(editor, i);
            return;
        }
    }
    // Wrap around
    for (let i = 0; i <= currentLine; i++) {
        if (regex.test(doc.lineAt(i).text)) {
            revealLine(editor, i);
            vscode.window.setStatusBarMessage(`↻ Wrapped to start — ${label}`, 2000);
            return;
        }
    }

    vscode.window.showInformationMessage(`No ${label} found`);
}

function goToPrevMatch(editor: vscode.TextEditor, regex: RegExp, label: string): void {
    if (editor.document.uri.scheme !== LogViewerSchema) {
        return;
    }

    const doc = editor.document;
    const currentLine = editor.selection.active.line;

    // Search backward from current line
    for (let i = currentLine - 1; i >= 0; i--) {
        if (regex.test(doc.lineAt(i).text)) {
            revealLine(editor, i);
            return;
        }
    }
    // Wrap around
    for (let i = doc.lineCount - 1; i >= currentLine; i--) {
        if (regex.test(doc.lineAt(i).text)) {
            revealLine(editor, i);
            vscode.window.setStatusBarMessage(`↻ Wrapped to end — ${label}`, 2000);
            return;
        }
    }

    vscode.window.showInformationMessage(`No ${label} found`);
}

function revealLine(editor: vscode.TextEditor, line: number): void {
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

function escapeRegex(str: string): string {
    return str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

// ── Registration ─────────────────────────────────────────────────────────

export function registerLogNavigation(subs: vscode.Disposable[], configSvc: IConfigService): void {
    // Sync search highlight with filter config
    function syncSearchHighlight(): void {
        const pattern = configSvc.getEffectiveFilterOptions().searchPattern;
        currentSearchPattern = pattern;
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            applySearchHighlight(editor);
        }
    }
    syncSearchHighlight();

    subs.push(
        searchHighlightDecoration,
        configSvc.onChange(() => syncSearchHighlight()),
        vscode.commands.registerCommand("logviewerplus.nextError", () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                goToNextMatch(editor, errorRegex, "ERROR");
            }
        }),
        vscode.commands.registerCommand("logviewerplus.prevError", () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                goToPrevMatch(editor, errorRegex, "ERROR");
            }
        }),
        vscode.commands.registerCommand("logviewerplus.nextWarning", () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                goToNextMatch(editor, warnRegex, "WARNING");
            }
        }),
        vscode.commands.registerCommand("logviewerplus.prevWarning", () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                goToPrevMatch(editor, warnRegex, "WARNING");
            }
        }),
        // Refresh search highlight when active editor changes
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                applySearchHighlight(editor);
            }
        }),
        // Refresh search highlight when document changes
        vscode.workspace.onDidChangeTextDocument(e => {
            const editor = vscode.window.activeTextEditor;
            if (editor?.document === e.document) {
                applySearchHighlight(editor);
            }
        }),
    );
}
