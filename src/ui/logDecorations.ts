/**
 * Log Level Decorations
 * Colors log level keywords (ERROR, WARN, INFO, DEBUG, TRACE) in log-viewer documents
 */

import * as vscode from "vscode";
import { LogViewerSchema } from "../core/logUri";

const levelPatterns: { level: string; regex: RegExp }[] = [
    { level: "ERROR", regex: /\b(ERROR|FATAL)\b|\*(ERROR|FATAL)\*|\[(ERROR|FATAL)\]/gi },
    { level: "WARN", regex: /\bWARN(?:ING)?\b|\*WARN(?:ING)?\*|\[WARN(?:ING)?\]/gi },
    { level: "INFO", regex: /\bINFO\b|\*INFO\*|\[INFO\]/gi },
    { level: "DEBUG", regex: /\bDEBUG\b|\*DEBUG\*|\[DEBUG\]/gi },
    { level: "TRACE", regex: /\bTRACE\b|\*TRACE\*|\[TRACE\]/gi },
];

function createDecorationType(color: string, bold: boolean): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        color,
        fontWeight: bold ? "bold" : "normal",
    });
}

const decorationTypes = {
    ERROR: createDecorationType("#f44747", true),
    WARN: createDecorationType("#cca700", true),
    INFO: createDecorationType("#3794ff", false),
    DEBUG: createDecorationType("#89d185", false),
    TRACE: createDecorationType("#888888", false),
};

function updateDecorations(editor: vscode.TextEditor): void {
    if (editor.document.uri.scheme !== LogViewerSchema) {
        return;
    }

    const text = editor.document.getText();
    const decorations: Record<string, vscode.DecorationOptions[]> = {
        ERROR: [],
        WARN: [],
        INFO: [],
        DEBUG: [],
        TRACE: [],
    };

    for (const { level, regex } of levelPatterns) {
        // Reset regex state
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            const startPos = editor.document.positionAt(match.index);
            const endPos = editor.document.positionAt(match.index + match[0].length);
            decorations[level].push({ range: new vscode.Range(startPos, endPos) });
        }
    }

    for (const [level, decs] of Object.entries(decorations)) {
        const decoType = decorationTypes[level as keyof typeof decorationTypes];
        editor.setDecorations(decoType, decs);
    }
}

export function registerLogDecorations(subs: vscode.Disposable[]): void {
    // Register all decoration types for disposal and event listeners
    subs.push(
        ...Object.values(decorationTypes),
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
