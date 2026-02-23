import * as vscode from "vscode";
import { registerInstance } from "./utils/container";
import { setDevEnv } from "./utils/util";
import { ConfigService } from "./types/configService";
import { createFilterStatusBarItem, registerFilterCommands } from "./filters/filterCommands";
import { registerLogExplorer, type LogExplorerTestHandles } from "./ui/logExplorer";
import { registerLogDecorations } from "./ui/logDecorations";
import { registerLogger } from "./utils/vscodeLogger";
import { registerLogWatchProvider } from "./core/logProvider";
import { registerStatusBarItems, type StatusBarItemsTestHandles } from "./ui/statusBar";
import { LogViewerSchema } from "./core/logUri";

export interface ExtensionTestHandles extends LogExplorerTestHandles, StatusBarItemsTestHandles {}

export function activate(context: vscode.ExtensionContext): ExtensionTestHandles | undefined {
    setDevEnv(context.extensionMode === vscode.ExtensionMode.Development);

    // Close any restored log-viewer-plus tabs from a previous session
    closeRestoredLogTabs();

    const subs = context.subscriptions;
    const configSvc = new ConfigService();
    subs.push(configSvc);
    registerInstance("config", configSvc);

    const logger = registerLogger(subs, configSvc);
    const logProvider = registerLogWatchProvider(subs, configSvc, logger);
    const statusBarItemsHandles = registerStatusBarItems(logProvider, subs, configSvc);
    const logExplorerHandles = registerLogExplorer(
        logProvider,
        subs,
        configSvc,
        logger,
        context.workspaceState,
    );

    // Register filter commands and status bar item
    registerFilterCommands(subs, configSvc);
    createFilterStatusBarItem(subs, { configSvc });
    registerLogDecorations(subs);

    if (context.extensionMode === vscode.ExtensionMode.Test) {
        return {
            ...logExplorerHandles,
            ...statusBarItemsHandles,
        };
    } else {
        return;
    }
}

export function deactivate(): void {
    // Extension cleanup handled by VS Code disposables
}

/**
 * Close any log-viewer-plus tabs that VS Code restored from the previous session.
 * These virtual documents are not editable and have no value when restored.
 */
function closeRestoredLogTabs(): void {
    const logTabs = vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .filter(tab => {
            const input = tab.input;
            return input instanceof vscode.TabInputText && input.uri.scheme === LogViewerSchema;
        });

    for (const tab of logTabs) {
        void vscode.window.tabGroups.close(tab);
    }
}
