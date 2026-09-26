import {createHash, randomUUID} from 'node:crypto';
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function canonical(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'; return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string,unknown>)[k])).join(',') + '}'; }
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const textHash = (value: string) => createHash('sha256').update(value).digest('hex');
