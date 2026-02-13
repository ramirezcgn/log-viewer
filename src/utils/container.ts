import type { IConfigService } from "../types/config";
import type { Logger } from "../utils/logger";

interface Container {
    config: IConfigService;
    logger: Logger;
}

const container: Map<string, unknown> = new Map<string, unknown>();

export function registerInstance<K extends keyof Container>(k: K, instance: Container[K]): void {
    container.set(k, instance);
}

export function getInstance<K extends keyof Container>(k: K): Container[K] {
    const instance = container.get(k);
    if (instance === undefined) {
        throw new Error(`Missing registration for "${k}"`);
    }
    return instance as Container[K];
}
