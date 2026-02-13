import * as picomatch from "picomatch";
import type * as picomatchTypes from "picomatch_types";
import { getInstance } from "../utils/container";
import { getPathImpl } from "../utils/util";

export type FixedPattern = string & { _fixed_pattern_tag_: unknown };

interface BeforeGlostarPartsBuilder {
    readonly head: FixedPattern;
    tail: BeforeGlostarPartsBuilder | undefined;
}

export interface BeforeGlobstarParts {
    readonly head: FixedPattern;
    readonly tail: BeforeGlobstarParts | undefined;
}

interface PathPattern {
    readonly basePath: string;
    readonly pattern: FixedPattern | null;
    readonly beforeGlobstarParts: BeforeGlobstarParts | undefined;
    readonly hasGlobstar: boolean;
}

interface FullPathPattern {
    readonly basePath: string;
    readonly fullPattern: FixedPattern;
    readonly beforeGlobstarParts: BeforeGlobstarParts | undefined;
    readonly hasGlobstar: boolean;
}

function append(
    bgp: BeforeGlostarPartsBuilder | undefined,
    pattern: FixedPattern,
): BeforeGlostarPartsBuilder {
    if (bgp) {
        bgp.tail = append(bgp.tail, pattern);
        return bgp;
    } else {
        return {
            head: pattern,
            tail: undefined,
        };
    }
}

function backslashPathSepAllowed(): boolean {
    if (getPathImpl().sep === "/") {
        return false;
    }
    const windowsCfg = getInstance("config").get("windows");
    if (windowsCfg) {
        return windowsCfg.allowBackslashAsPathSeparator;
    } else {
        return false;
    }
}

function patternSplit(pattern: string): FixedPattern[] {
    let sep: string | RegExp = "/";
    if (backslashPathSepAllowed()) {
        sep = /[/\\]/;
    }
    return pattern.split(sep) as FixedPattern[];
}

function patternJoin(parts: FixedPattern[]): FixedPattern {
    return parts.join("/") as FixedPattern;
}

function patternResolve(basePath: string, pattern: FixedPattern | null): FixedPattern {
    basePath = fixPathSeparators(basePath).replace(/\/$/, "");
    let res: string;
    if (pattern) {
        res = `${basePath}/${pattern}`;
    } else {
        res = basePath;
    }
    return res as FixedPattern;
}

/**
 * use "/" as dir separator for pattern
 * because "\" won't work properly with micromatch
 */
export function fixPatternPathSeparators(pattern: string): FixedPattern {
    if (backslashPathSepAllowed()) {
        // if here "\" means dir separator not escaped char
        return pattern.replaceAll("\\", "/") as FixedPattern;
    }
    // here "\" means escaped char
    return pattern as FixedPattern;
}

function getUnescapedPathSegment(ast: picomatchTypes.Ast): string | null {
    let sb = "";
    for (const node of ast.tokens) {
        // oxlint-disable-next-line switch-exhaustiveness-check
        switch (node.type) {
            // basePathOkNodes
            case "bos":
            case "dot":
            case "comma":
                sb += node.value;
                break;
            case "text":
                // unescape
                sb += node.value.replaceAll("\\", "");
                break;
            default:
                return null;
        }
    }
    return sb;
}

function parsePattern(pattern: string): PathPattern {
    const parts = patternSplit(pattern);

    let kind: "inBasePath" | "afterGlobstar" | "inPattern" = "inBasePath";

    const basePathParts: string[] = [];
    const patternParts: FixedPattern[] = [];
    let beforeGlobstarParts: BeforeGlostarPartsBuilder | undefined;

    for (const part of parts) {
        if (kind !== "afterGlobstar") {
            const ast = picomatch.parse(part, {
                // otherwise in some cases there are missing tokens
                fastpaths: false,
            });
            if (ast.tokens.some(n => n.type === "globstar")) {
                kind = "afterGlobstar";
            } else if (kind === "inBasePath") {
                const pathPart = getUnescapedPathSegment(ast);
                if (pathPart === null) {
                    kind = "inPattern";
                } else {
                    basePathParts.push(pathPart);
                    continue;
                }
            }
        }

        switch (kind) {
            case "inPattern":
                patternParts.push(part);
                beforeGlobstarParts = append(beforeGlobstarParts, part);
                break;
            case "afterGlobstar":
                patternParts.push(part);
                break;
        }
    }

    if (patternParts.length) {
        // to distinguish root [""] => ["", ""] => "/"
        // from relative path [] => [""] => ""
        basePathParts.push("");
    }

    const basePath = basePathParts.join(getPathImpl().sep);
    const patternPart = patternParts.length ? patternJoin(patternParts) : null;
    return {
        basePath: basePath,
        beforeGlobstarParts: beforeGlobstarParts,
        pattern: patternPart,
        hasGlobstar: kind === "afterGlobstar",
    };
}

/**
 * micromatch doesn't work properly with "\" as directory separator
 * replace with "/" for matching
 */
export function fixPathSeparators(somePath: string): string {
    if (getPathImpl().sep === "\\") {
        return somePath.replaceAll("\\", "/");
    }
    return somePath;
}

export function toFullPathPattern(pattern: string, cwd: string | undefined): FullPathPattern {
    const parsed = parsePattern(pattern);

    let basePath = parsed.basePath;
    let fullPattern = fixPatternPathSeparators(pattern);
    if (cwd !== undefined && cwd !== null) {
        const path = getPathImpl();
        if (!path.isAbsolute(basePath)) {
            basePath = path.join(cwd, basePath);
            fullPattern = patternResolve(basePath, parsed.pattern);
        }
    }

    return {
        basePath: basePath,
        beforeGlobstarParts: parsed.beforeGlobstarParts,
        fullPattern: fullPattern,
        hasGlobstar: parsed.hasGlobstar,
    };
}
