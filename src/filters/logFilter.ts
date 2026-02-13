/**
 * Log Filter and Parser
 * Parses and filters log files with configurable format support
 */

export enum LogLevel {
    TRACE = 5,
    DEBUG = 4,
    INFO = 3,
    WARN = 2,
    ERROR = 1,
}

interface LogLine {
    timestamp: string;
    level: LogLevel;
    source: string;  // thread, class, logger name, etc.
    message: string;
    originalLine: string;
}

export interface LogFilterOptions {
    minLevel: LogLevel;
    searchPattern?: string;
    searchRegex?: RegExp;
    cleanFormat: boolean;
    excludePatterns?: string[];
    includePatterns?: string[];
}

/**
 * Statistics from log content
 */
export interface LogStats {
    totalLines: number;
    errorCount: number;
    warnCount: number;
    infoCount: number;
    debugCount: number;
    traceCount: number;
    unparsedCount: number;
}

/**
 * Log format definition
 */
export interface LogFormat {
    name: string;
    regex: RegExp;
    groups: {
        timestamp: number;
        level: number;
        source: number;
        message: number;
    };
}

/**
 * Built-in log format presets
 */
const levelPattern = "ERROR|FATAL|WARN(?:ING)?|INFO|DEBUG|TRACE";

const builtInFormats: LogFormat[] = [
    {
        name: "sling",
        regex: /^(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+\*(\w+)\*\s+\[([^\]]+)\]\s+(.*)$/,
        groups: { timestamp: 1, level: 2, source: 3, message: 4 },
    },
    {
        name: "iso",
        regex: new RegExp(String.raw`^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.,]\d{3}\S*)\s+(${levelPattern})\s+\[([^\]]+)\]\s+(.*)$`, "i"),
        groups: { timestamp: 1, level: 2, source: 3, message: 4 },
    },
    {
        name: "iso-plain",
        regex: new RegExp(String.raw`^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.,]\d{3}\S*)\s+(${levelPattern})\s+(\S+)\s+[-–]\s+(.*)$`, "i"),
        groups: { timestamp: 1, level: 2, source: 3, message: 4 },
    },
    {
        name: "logback",
        regex: new RegExp(String.raw`^(\d{2}:\d{2}:\d{2}[.,]\d{3})\s+\[([^\]]+)\]\s+(${levelPattern})\s+(.*)$`, "i"),
        groups: { timestamp: 1, level: 3, source: 2, message: 4 },
    },
    {
        name: "syslog",
        regex: /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+?)(?:\[\d+\])?:\s+(.*)$/,
        groups: { timestamp: 1, level: -1, source: 3, message: 4 },
    },
    {
        name: "simple",
        regex: new RegExp(String.raw`^\[?(${levelPattern})\]?\s+(.*)$`, "i"),
        groups: { timestamp: -1, level: 1, source: -1, message: 2 },
    },
];

let activeFormats: LogFormat[] = [...builtInFormats];

/**
 * Set custom log formats. If provided, they are tried first, then built-in formats.
 */
export function setCustomFormats(customFormats: LogFormat[]): void {
    activeFormats = [...customFormats, ...builtInFormats];
}

function parseLevelString(levelStr: string): LogLevel {
    switch (levelStr.toUpperCase()) {
        case "ERROR":
        case "FATAL":
            return LogLevel.ERROR;
        case "WARN":
        case "WARNING":
            return LogLevel.WARN;
        case "INFO":
            return LogLevel.INFO;
        case "DEBUG":
            return LogLevel.DEBUG;
        case "TRACE":
            return LogLevel.TRACE;
        default:
            return LogLevel.INFO;
    }
}

/**
 * Parses a log line trying all active formats
 */
function parseLogLine(line: string): LogLine | null {
    for (const format of activeFormats) {
        const match = format.regex.exec(line);
        if (match) {
            const g = format.groups;
            return {
                timestamp: g.timestamp > 0 ? match[g.timestamp] : "",
                level: g.level > 0 ? parseLevelString(match[g.level]) : LogLevel.INFO,
                source: g.source > 0 ? match[g.source] : "",
                message: g.message > 0 ? match[g.message] : line,
                originalLine: line,
            };
        }
    }
    return null;
}

function isFilterOptionsActive(options: LogFilterOptions): boolean {
    return options.minLevel !== LogLevel.TRACE
        || !!options.searchPattern
        || !!options.searchRegex
        || options.cleanFormat
        || (!!options.excludePatterns && options.excludePatterns.length > 0)
        || (!!options.includePatterns && options.includePatterns.length > 0);
}

/**
 * Checks if a log line should be filtered out based on filter options
 */
function shouldFilterLine(parsedLine: LogLine | null, options: LogFilterOptions): boolean {

    // If line couldn't be parsed, keep it unless we're in clean format mode
    if (!parsedLine) {
        return options.cleanFormat;
    }

    // Filter by level
    if (parsedLine.level > options.minLevel) {
        return true; // Filter out (log level is less severe than minimum)
    }

    // Filter by exclude patterns
    if (options.excludePatterns && options.excludePatterns.length > 0) {
        for (const pattern of options.excludePatterns) {
            if (parsedLine.message.includes(pattern) || parsedLine.originalLine.includes(pattern)) {
                return true;
            }
        }
    }

    // Filter by include patterns (if set, only matching lines are shown)
    if (options.includePatterns && options.includePatterns.length > 0) {
        let matches = false;
        for (const pattern of options.includePatterns) {
            if (parsedLine.message.includes(pattern) || parsedLine.originalLine.includes(pattern)) {
                matches = true;
                break;
            }
        }
        if (!matches) {
            return true; // Filter out lines that don't match any include pattern
        }
    }

    // Filter by search pattern
    if (options.searchPattern) {
        const searchLower = options.searchPattern.toLowerCase();
        if (!parsedLine.message.toLowerCase().includes(searchLower) && 
            !parsedLine.originalLine.toLowerCase().includes(searchLower)) {
            return true;
        }
    }

    // Filter by regex
    if (options.searchRegex) {
        if (!options.searchRegex.test(parsedLine.message) && 
            !options.searchRegex.test(parsedLine.originalLine)) {
            return true;
        }
    }

    return false; // Don't filter - show this line
}

/**
 * Formats a parsed log line according to options
 */
function formatLogLine(parsedLine: LogLine | null, options: LogFilterOptions): string {
    if (!parsedLine) {
        return ""; // Return empty for unparseable lines in clean mode
    }

    if (options.cleanFormat) {
        return parsedLine.message;
    }

    return parsedLine.originalLine;
}

/**
 * Filters and formats log content
 */
export function filterLogContent(content: string, options: LogFilterOptions): string {
    if (!isFilterOptionsActive(options)) {
        return content;
    }

    const lines = content.split(/\r?\n/);
    const filteredLines: string[] = [];

    for (const line of lines) {
        if (!line.trim()) {
            continue; // Skip empty lines
        }

        const parsed = parseLogLine(line);
        
        if (shouldFilterLine(parsed, options)) {
            continue; // Skip this line
        }

        const formatted = formatLogLine(parsed, options);
        if (formatted) {
            filteredLines.push(formatted);
        }
    }

    return filteredLines.join("\n");
}

/**
 * Collects statistics from raw log content
 */
export function getLogStats(content: string): LogStats {
    const stats: LogStats = {
        totalLines: 0,
        errorCount: 0,
        warnCount: 0,
        infoCount: 0,
        debugCount: 0,
        traceCount: 0,
        unparsedCount: 0,
    };

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        if (!line.trim()) {
            continue;
        }
        stats.totalLines++;
        const parsed = parseLogLine(line);
        if (!parsed) {
            stats.unparsedCount++;
            continue;
        }
        switch (parsed.level) {
            case LogLevel.ERROR:
                stats.errorCount++;
                break;
            case LogLevel.WARN:
                stats.warnCount++;
                break;
            case LogLevel.INFO:
                stats.infoCount++;
                break;
            case LogLevel.DEBUG:
                stats.debugCount++;
                break;
            case LogLevel.TRACE:
                stats.traceCount++;
                break;
        }
    }

    return stats;
}

