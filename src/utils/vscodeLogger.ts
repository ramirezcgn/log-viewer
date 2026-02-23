import * as vscode from "vscode";
import { registerInstance } from "../utils/container";
import { Logger } from "../utils/logger";
import type { ConfigService } from "../types/configService";

const showExtensionLogsCmd = "logviewerplus.showExtensionLogs";

function inner(x: unknown): string {
    if (typeof x === "string") {
        return x;
    } else {
        return JSON.stringify(x, undefined, "\t");
    }
}

function toStr(x: unknown): string {
    if (typeof x === "function" && x.length === 0) {
        // oxlint-disable-next-line no-unsafe-call
        return toStr(x());
    } else {
        return inner(x);
    }
}

class OutputChannelLogger extends Logger implements vscode.Disposable {
    private _outputChannel: vscode.OutputChannel | undefined;
    private get outputChannel(): vscode.OutputChannel {
        this._outputChannel ??= vscode.window.createOutputChannel("log-viewer-plus");
        return this._outputChannel;
    }
    protected log(level: string, x: unknown): void {
        const str = level + " " + toStr(x);
        this.outputChannel.appendLine(str);
    }

    public override dispose(): void {
        if (this._outputChannel) {
            this._outputChannel.dispose();
        }
        super.dispose();
    }

    public show(): void {
        this.outputChannel.show();
    }
}

export function registerLogger(subs: vscode.Disposable[], configSvc: ConfigService): Logger {
    const logger = new OutputChannelLogger(configSvc);
    subs.push(logger);
    registerInstance("logger", logger);

    subs.push(
        vscode.commands.registerCommand(showExtensionLogsCmd, () => {
            logger.show();
        }),
    );

    return logger;
}
