/**
 * Log Level Decorations & Semantic Colorization
 * Colors log level keywords and auto-detects log parts (timestamp, source, message)
 */

import * as vscode from "vscode";
import { LogViewerSchema } from "../core/logUri";
import { getActiveFormats, type LogFormat } from "../filters/logFilter";

// ── Level keyword patterns (for coloring the level token itself) ──────────

const levelPatterns: { level: string; regex: RegExp }[] = [
    { level: "ERROR", regex: /\b(ERROR|FATAL)\b|\*(ERROR|FATAL)\*|\[(ERROR|FATAL)\]/gi },
    { level: "WARN", regex: /\bWARN(?:ING)?\b|\*WARN(?:ING)?\*|\[WARN(?:ING)?\]/gi },
    { level: "INFO", regex: /\bINFO\b|\*INFO\*|\[INFO\]/gi },
    { level: "DEBUG", regex: /\bDEBUG\b|\*DEBUG\*|\[DEBUG\]/gi },
    { level: "TRACE", regex: /\bTRACE\b|\*TRACE\*|\[TRACE\]/gi },
];

// ── Level keyword decoration types ───────────────────────────────────────

function createDecorationType(color: string, bold: boolean): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        color,
        fontWeight: bold ? "bold" : "normal",
    });
}

const levelDecorationTypes = {
    ERROR: createDecorationType("#f44747", true),
    WARN: createDecorationType("#cca700", true),
    INFO: createDecorationType("#3794ff", false),
    DEBUG: createDecorationType("#89d185", false),
    TRACE: createDecorationType("#888888", false),
};

// ── Semantic part decoration types ───────────────────────────────────────

const timestampDecoration = vscode.window.createTextEditorDecorationType({
    color: "#888888",                       // dim gray
});

const sourceDecoration = vscode.window.createTextEditorDecorationType({
    color: "#4EC9B0",                       // teal / cyan
});

const messageDecoration = vscode.window.createTextEditorDecorationType({
    color: "#D4D4D4",                       // light gray (stands out in dark themes)
    light: { color: "#1e1e1e" },            // dark for light themes
});

// ── Diagnostics (minimap + overview ruler marks) ─────────────────────────

let diagnosticCollection: vscode.DiagnosticCollection;

function updateDiagnostics(doc: vscode.TextDocument): void {
    if (doc.uri.scheme !== LogViewerSchema) {
        diagnosticCollection.delete(doc.uri);
        return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const text = doc.getText();
    const seenLines = new Set<number>();

    for (const { level, regex } of levelPatterns) {
        if (level !== "ERROR" && level !== "WARN") {
            continue;
        }
        const severity = level === "ERROR"
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning;

        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            const line = doc.positionAt(match.index).line;
            if (seenLines.has(line)) {
                continue;
            }
            seenLines.add(line);
            const lineRange = doc.lineAt(line).range;
            const diag = new vscode.Diagnostic(lineRange, match[0], severity);
            diag.source = "log-viewer";
            diagnostics.push(diag);
        }
    }

    diagnosticCollection.set(doc.uri, diagnostics);
}

// ── Regex copies with `d` flag for group indices ─────────────────────────

/**
 * We cache per-format regex copies that include the `d` (hasIndices) flag
 * so that `match.indices[groupNum]` gives [start, end] positions.
 */
const indexRegexCache = new Map<LogFormat, RegExp>();

function getIndexRegex(fmt: LogFormat): RegExp {
    let rx = indexRegexCache.get(fmt);
    if (!rx) {
        const flags = fmt.regex.flags.includes("d") ? fmt.regex.flags : fmt.regex.flags + "d";
        rx = new RegExp(fmt.regex.source, flags);
        indexRegexCache.set(fmt, rx);
    }
    return rx;
}

// ── Main decoration update ───────────────────────────────────────────────

function updateDecorations(editor: vscode.TextEditor): void {
    if (editor.document.uri.scheme !== LogViewerSchema) {
        return;
    }

    const doc = editor.document;
    const lineCount = doc.lineCount;

    // Level keyword decorations (global regex over full text)
    const text = doc.getText();
    const levelDecs: Record<string, vscode.DecorationOptions[]> = {
        ERROR: [], WARN: [], INFO: [], DEBUG: [], TRACE: [],
    };

    for (const { level, regex } of levelPatterns) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            const startPos = doc.positionAt(match.index);
            const endPos = doc.positionAt(match.index + match[0].length);
            levelDecs[level].push({ range: new vscode.Range(startPos, endPos) });
        }
    }
    for (const [level, decs] of Object.entries(levelDecs)) {
        editor.setDecorations(levelDecorationTypes[level as keyof typeof levelDecorationTypes], decs);
    }

    // Semantic part decorations (per-line parsing)
    const formats = getActiveFormats();
    const timestampRanges: vscode.DecorationOptions[] = [];
    const sourceRanges: vscode.DecorationOptions[] = [];
    const messageRanges: vscode.DecorationOptions[] = [];

    for (let i = 0; i < lineCount; i++) {
        const line = doc.lineAt(i);
        if (line.isEmptyOrWhitespace) {
            continue;
        }

        const lineText = line.text;
        let matched = false;

        for (const fmt of formats) {
            const rx = getIndexRegex(fmt);
            rx.lastIndex = 0;
            const m = rx.exec(lineText);
            if (!m?.indices) {
                continue;
            }

            const g = fmt.groups;

            // Timestamp
            if (g.timestamp > 0 && m.indices[g.timestamp]) {
                const [s, e] = m.indices[g.timestamp];
                timestampRanges.push({
                    range: new vscode.Range(i, s, i, e),
                });
            }

            // Source / thread
            if (g.source > 0 && m.indices[g.source]) {
                const [s, e] = m.indices[g.source];
                sourceRanges.push({
                    range: new vscode.Range(i, s, i, e),
                });
            }

            // Message
            if (g.message > 0 && m.indices[g.message]) {
                const [s, e] = m.indices[g.message];
                messageRanges.push({
                    range: new vscode.Range(i, s, i, e),
                });
            }

            matched = true;
            break; // first matching format wins
        }

        // Lines that match no format stay with default coloring
        if (!matched) {
            continue;
        }
    }

    editor.setDecorations(timestampDecoration, timestampRanges);
    editor.setDecorations(sourceDecoration, sourceRanges);
    editor.setDecorations(messageDecoration, messageRanges);

    // Diagnostics for minimap + overview ruler marks
    updateDiagnostics(doc);
}

// ── Registration ─────────────────────────────────────────────────────────

export function registerLogDecorations(subs: vscode.Disposable[]): void {
    diagnosticCollection = vscode.languages.createDiagnosticCollection("log-viewer");

    subs.push(
        diagnosticCollection,
        ...Object.values(levelDecorationTypes),
        timestampDecoration,
        sourceDecoration,
        messageDecoration,
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                updateDecorations(editor);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (event.document === editor?.document) {
                updateDecorations(editor);
            }
        }),
    );

    // Initial decoration
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        updateDecorations(editor);
    }
}
