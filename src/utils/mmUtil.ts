import type * as picomatchTypes from "picomatch_types";
import {
    fixPathSeparators,
    fixPatternPathSeparators,
    toFullPathPattern,
    type BeforeGlobstarParts,
    type FixedPattern,
} from "../utils/pathPattern";
import picomatch = require("picomatch");
import { getPathImpl } from "../utils/util";

export interface PathMatcher {
    readonly basePath: string;
    readonly patterns: BeforeGlobstarParts | undefined;
    readonly hasGlobstar: boolean;
    readonly nameIgnoreMatcher: (name: string) => boolean;
    readonly fullPathMatcher: (path: string) => boolean;
}

interface PathMatcherOptions {
    cwd?: string;
    nameIgnorePattern?: string;
}

const myMmOptions: picomatchTypes.Options = {
    dot: true,
};

export function myIsMatch(somePath: string, pattern: FixedPattern): boolean {
    somePath = fixPathSeparators(somePath);
    return picomatch.isMatch(somePath, pattern, myMmOptions);
}

function myMatcher(pattern: FixedPattern): (str: string) => boolean {
    const matcher = picomatch(pattern, myMmOptions);
    if (getPathImpl().sep === "\\") {
        //micromatch doesn't work properly with "\" as directory separator
        //replace with "/" for matching
        return str => matcher(str.replaceAll("\\", "/"));
    } else {
        return matcher;
    }
}

export function toPathMatcher(pattern: string, options?: PathMatcherOptions): PathMatcher {
    const p = toFullPathPattern(pattern, options?.cwd);

    const fullPathMatcher = myMatcher(p.fullPattern);
    let nameIgnoreMatcher: (name: string) => boolean;
    if (options?.nameIgnorePattern === null || options?.nameIgnorePattern === undefined) {
        nameIgnoreMatcher = _ => false;
    } else {
        const nameIgnorePattern = fixPatternPathSeparators(options.nameIgnorePattern);
        nameIgnoreMatcher = myMatcher(nameIgnorePattern);
    }

    return {
        basePath: p.basePath,
        patterns: p.beforeGlobstarParts,
        hasGlobstar: p.hasGlobstar,
        fullPathMatcher: fullPathMatcher,
        nameIgnoreMatcher: nameIgnoreMatcher,
    };
}
