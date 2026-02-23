import * as vscode from "vscode";
import { getPathImpl, patternDescription } from "../utils/util";
import type { ConfigService } from "../types/configService";
import { openLogResourceCmd } from "../ui/logExplorer";
import type { LogWatchProvider, WatchState } from "../core/logProvider";
import { fromLogUri, LogViewerSchema } from "../core/logUri";

const toggleFollowTailCmd = "logviewerplus.toggleFollowTail";
const clearCmd = "logviewerplus.clearLogView";
const resetCmd = "logviewerplus.resetLogView";
const openCurrentFileCmd = "logviewerplus.openCurrentFile";
const openLastChangedCmd = "logviewerplus.openLastChanged";

interface StatusBarComponent {
    show(): void;
    hide(): void;
}

let _statusBarItemPriority = 0;

interface Command {
    name: string;
    action: () => void | Promise<void>;
}

interface SimpleStatusBarComponentProps {
    command?: Command;
    text: string;
    tooltip?: string;
}

function simpleStatusBarComponent(
    subs: vscode.Disposable[],
    props: SimpleStatusBarComponentProps,
): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(undefined, _statusBarItemPriority++);
    subs.push(item);
    item.text = props.text;
    if (props.tooltip !== null) {
        item.tooltip = props.tooltip;
    }
    if (props.command) {
        item.command = props.command.name;
        subs.push(vscode.commands.registerCommand(props.command.name, props.command.action));
    }
    return item;
}

function shouldHandle(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
    if (!editor) {
        return false;
    }
    return editor.document.uri.scheme === LogViewerSchema;
}

class FollowTailStatusBarComponent implements StatusBarComponent {
    private readonly followTailState = new WeakMap<vscode.TextEditor, boolean>();
    // public for tests
    public readonly item: vscode.StatusBarItem;
    constructor(
        subs: vscode.Disposable[],
        private readonly configSvc: ConfigService,
    ) {
        this.item = simpleStatusBarComponent(subs, {
            text: "",
            command: {
                name: toggleFollowTailCmd,
                action: () => {
                    const editor = vscode.window.activeTextEditor;
                    if (shouldHandle(editor)) {
                        const followTail = this.getFollowTail(editor);
                        this.setFollowTail(editor, !followTail);
                    }
                },
            },
        });
        subs.push(
            vscode.window.onDidChangeTextEditorVisibleRanges(this.onDidChangeTextEditorVisibleRanges),
            vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument)
        );
    }

    public show(): void {
        this.item.show();
        const editor = vscode.window.activeTextEditor;
        if (shouldHandle(editor)) {
            this.refresh(editor);
        }
    }
    public hide(): void {
        this.item.hide();
    }

    private refresh(editor: vscode.TextEditor) {
        const followTail = this.getFollowTail(editor);
        if (editor === vscode.window.activeTextEditor) {
            this.item.text = followTail ? "Follow Tail: On" : "Follow Tail: Off";
        }
        if (followTail) {
            this.jumpToTail(editor);
        }
    }

    private getFollowTail(editor: vscode.TextEditor): boolean {
        // deault to true
        return this.followTailState.get(editor) ?? true;
    }

    private setFollowTail(editor: vscode.TextEditor, value: boolean) {
        if (value === this.getFollowTail(editor)) {
            return;
        }
        this.followTailState.set(editor, value);
        this.refresh(editor);
    }

    private jumpToTail(editor: vscode.TextEditor) {
        const lastLineRange = editor.document.lineAt(editor.document.lineCount - 1).range;
        editor.revealRange(lastLineRange);
    }

    private readonly onDidChangeTextEditorVisibleRanges = (e: vscode.TextEditorVisibleRangesChangeEvent) => {
        if (!shouldHandle(e.textEditor)) {
            return;
        }
        if (!e.visibleRanges.length) {
            return;
        }
        if (this.configSvc.get("followTailMode") === "manual") {
            return;
        }
        const lastLine = e.visibleRanges.at(-1)!.end.line;
        const lastDocLine = e.textEditor.document.lineCount - 1;
        if (lastLine < lastDocLine) {
            this.setFollowTail(e.textEditor, false);
        } else {
            this.setFollowTail(e.textEditor, true);
        }
    };

    private readonly onDidChangeTextDocument = (e: vscode.TextDocumentChangeEvent) => {
        const editor = vscode.window.visibleTextEditors.find(vte => vte.document === e.document);
        if (!shouldHandle(editor)) {
            return;
        }
        if (!this.getFollowTail(editor)) {
            return;
        }
        if (editor.selection.isEmpty) {
            // hack that prevents text inserted at the end from being selected
            // when the cursor position is at the end of the document
            editor.selection = editor.selection;
        }
        this.jumpToTail(editor);
    };
}

// this item is not contextual to the activeTextEditor
// it's shown whenever a watch changes in the background (if the config is enabled)
class LastChangedStatusBarItem {
    // public for tests
    public readonly item: vscode.StatusBarItem;
    private lastState: WatchState | undefined;
    private intervalHandle: NodeJS.Timeout | undefined;

    constructor(
        subs: vscode.Disposable[],
        private readonly configSvc: ConfigService,
    ) {
        this.item = simpleStatusBarComponent(subs, {
            text: "",
            command: {
                name: openLastChangedCmd,
                action: async () => {
                    if (this.lastState) {
                        await vscode.commands.executeCommand(openLogResourceCmd, this.lastState.uri);
                    }
                    this.clear();
                },
            },
        });

        subs.push(vscode.window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor));
    }

    private readonly onDidChangeActiveTextEditor = (editor: vscode.TextEditor | undefined) => {
        if (!this.lastState) {
            return;
        }
        if (editor?.document.uri.toString() === this.lastState.uri.toString()) {
            this.clear();
        }
    };

    private readonly onInterval = () => {
        if (!this.lastState) {
            return;
        }
        const secs = Math.round((Date.now() - this.lastState.lastChangedOn.getTime()) / 1000);
        let timeStr;
        if (secs >= 60) {
            const mins = Math.floor(secs / 60);
            timeStr = `${mins}min`;
        } else {
            timeStr = `${secs}s`;
        }
        this.item.tooltip = `changed ${timeStr} ago`;
    };

    private clear() {
        this.lastState = undefined;
        this.item.hide();
        this.item.text = "";
        this.clearInterval();
    }

    private clearInterval() {
        this.item.tooltip = "";
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = undefined;
        }
    }

    public setLastChanged(state: WatchState): void {
        if (this.configSvc.get("showStatusBarItemOnChange") ?? false) {
            this.lastState = state;
            if (this.intervalHandle) {
                this.onInterval();
            } else {
                this.intervalHandle = setInterval(this.onInterval, 1000);
            }
            const w = fromLogUri(state.uri);
            const title = w.title ?? patternDescription(w.pattern);
            this.item.text = `$(bell) Changes in: ${title}`;
            this.item.show();
        } else {
            this.clear();
        }
    }
}

//icons in https://octicons.github.com/

export interface StatusBarItemsTestHandles {
    lastChange: vscode.StatusBarItem;
    watchingInfo: vscode.StatusBarItem;
    followTail: vscode.StatusBarItem;
    reset: vscode.StatusBarItem;
    clear: vscode.StatusBarItem;
}

export function registerStatusBarItems(
    logProvider: LogWatchProvider,
    subs: vscode.Disposable[],
    configSvc: ConfigService,
): StatusBarItemsTestHandles {
    // last changed watch
    const lastChangeItem = new LastChangedStatusBarItem(subs, configSvc);

    const watchingInfoItem = simpleStatusBarComponent(subs, {
        text: "",
        tooltip: "",
        command: {
            name: openCurrentFileCmd,
            action: async () => {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    return;
                }
                const logUri = activeEditor.document.uri;
                if (logUri.scheme !== LogViewerSchema) {
                    return;
                }
                const state = logProvider.get(logUri);
                if (state?.lastFileName) {
                    const doc = await vscode.workspace.openTextDocument(state.lastFileName);
                    await vscode.window.showTextDocument(doc);
                }
            },
        },
    });

    //follow tail

    const followTailComponent = new FollowTailStatusBarComponent(subs, configSvc);

    //reset

    const resetItem = simpleStatusBarComponent(subs, {
        text: "$(history) Reset",
        command: {
            name: resetCmd,
            action: async () => {
                if (vscode.window.activeTextEditor) {
                    const uri = vscode.window.activeTextEditor.document.uri;
                    await logProvider.restoreContents(uri);
                }
            },
        },
    });

    //clear

    const clearItem = simpleStatusBarComponent(subs, {
        text: "$(x) Clear",
        command: {
            name: clearCmd,
            action: async () => {
                if (vscode.window.activeTextEditor) {
                    const uri = vscode.window.activeTextEditor.document.uri;
                    await logProvider.clearContents(uri);
                }
            },
        },
    });

    // state change handling

    function checkShow(activeEditor: vscode.TextEditor | undefined) {
        let state: WatchState | undefined;
        if (shouldHandle(activeEditor)) {
            state = logProvider.get(activeEditor.document.uri);
        }

        if (state === undefined) {
            followTailComponent.hide();
            clearItem.hide();
            resetItem.hide();
            watchingInfoItem.hide();
            return;
        }

        if (state.running) {
            followTailComponent.show();
            clearItem.show();
            resetItem.show();
        } else {
            followTailComponent.hide();
            clearItem.hide();
            resetItem.hide();
        }

        if (state.lastFileName) {
            watchingInfoItem.show();
            watchingInfoItem.text = "$(file-text) " + getPathImpl().basename(state.lastFileName);
            watchingInfoItem.tooltip = state.lastFileName;
        } else {
            watchingInfoItem.hide();
        }
    }

    checkShow(vscode.window.activeTextEditor);

    subs.push(
        vscode.window.onDidChangeActiveTextEditor(checkShow),
        logProvider.onChange(e => {
            const editor = vscode.window.activeTextEditor;
            if (editor?.document.uri.toString() === e.uri.toString()) {
                checkShow(editor);
            } else {
                const state = logProvider.get(e.uri);
                if (state) {
                    lastChangeItem.setLastChanged(state);
                }
            }
        }),
    );

    return {
        clear: clearItem,
        followTail: followTailComponent.item,
        lastChange: lastChangeItem.item,
        reset: resetItem,
        watchingInfo: watchingInfoItem,
    };
}
