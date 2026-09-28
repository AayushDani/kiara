/** Only opaque record identifiers enter Temporal payloads. No source text, tokens, prompts or packets. */
export interface MatterReference {tenantId:string;aggregateId:string}
export interface OutboxReference extends MatterReference {outboxId:string}
export interface ReconcileResult {status:'waiting'|'terminal'|'reconciliation_required'|'legacy_owned'|'unavailable';version:number;unresolvedEffects:number}
export const changedSignalName='kiaraMatterChanged';
