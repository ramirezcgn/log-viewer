import { performance } from "node:perf_hooks";
import { LogLevel, type IConfigService } from "../types/config";
import { isDevEnv } from "../utils/util";
import type { Disposable } from "../types/vscodeTypes";

function getLogLevel(config: IConfigService): LogLevel {
    const logLevelKey = config.get("logLevel");
    if (logLevelKey !== null && logLevelKey !== undefined && typeof logLevelKey === "string") {
        const logLevel = LogLevel[logLevelKey];
        if (logLevel !== null) {
            return logLevel;
        }
    }
    if (isDevEnv()) {
        return LogLevel.debug;
    } else {
        return LogLevel.error;
    }
}

export abstract class Logger implements Disposable {
    private readonly disposable: Disposable;

    constructor(config: IConfigService) {
        this.logLevel = getLogLevel(config);
        this.disposable = config.onChange(() => {
            this.logLevel = getLogLevel(config);
        });
    }
    private logLevel: LogLevel;
    private readonly _times: { [label: string]: number } = {};
    protected abstract log(level: string, x: unknown): void;

    public trace(x: unknown): void {
        if (this.logLevel > LogLevel.trace) {
            return;
        }
        this.log("[TRACE]", x);
    }

    public debug(x: unknown): void {
        if (this.logLevel > LogLevel.debug) {
            return;
        }
        this.log("[DEBUG]", x);
    }

    public info(x: unknown): void {
        if (this.logLevel > LogLevel.info) {
            return;
        }
        this.log("[INFO]", x);
    }

    public warn(x: unknown): void {
        if (this.logLevel > LogLevel.warn) {
            return;
        }
        this.log("[WARN]", x);
    }

    public error(x: unknown): void {
        if (this.logLevel > LogLevel.error) {
            return;
        }
        this.log("[ERROR]", x);
    }

    public timeStart(label: string): void {
        if (this.logLevel > LogLevel.trace) {
            return;
        }
        this._times[label] = performance.now();
    }
    public timeEnd(label: string): void {
        if (this.logLevel > LogLevel.trace) {
            return;
        }
        const t0 = this._times[label];
        if (t0) {
            const t1 = performance.now();
            delete this._times[label];
            const ms = (t1 - t0).toFixed(2);
            this.trace(`${label} ${ms} ms`);
        }
    }

    public dispose(): void {
        this.disposable.dispose();
    }
}
