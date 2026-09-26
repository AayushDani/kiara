import {AppError} from '../server/contracts';
import {hash} from '../server/hash';

/** Protected operator configuration. Strategies and model output cannot change these values. */
export const AUTHORIZED_SPEND_CEILING_USD = 50;
export const PRICING_VERSION = 'openai-standard-short-context-2026-09-26';
export const MODEL_PRICES = Object.freeze({
  'gpt-6-astra': {input: 10, cached_input: 1, output: 50},
  'gpt-6-sol': {input: 2, cached_input: 0.2, output: 10},
});
export type SupportedModel = keyof typeof MODEL_PRICES;
export type ReasoningEffort = 'low' | 'medium' | 'high';
export interface RuntimeConfig {
  model: SupportedModel;
  review_model: SupportedModel;
  reasoning_effort: ReasoningEffort;
  pricing_version: string;
  service_tier: 'default';
  config_version: string;
}
export function runtimeConfig(): RuntimeConfig {
  const model = process.env.KIARA_MODEL || 'gpt-6-astra';
  const review_model = process.env.KIARA_REVIEW_MODEL || model;
  const reasoning_effort = process.env.KIARA_REASONING_EFFORT || 'medium';
  if (!Object.hasOwn(MODEL_PRICES,model) || !Object.hasOwn(MODEL_PRICES,review_model) || !['low','medium','high'].includes(reasoning_effort)) {
    throw new AppError('MODEL_POLICY_MISMATCH','The configured model or reasoning effort is outside the reviewed provider policy.');
  }
  const config = {model: model as SupportedModel, review_model: review_model as SupportedModel, reasoning_effort: reasoning_effort as ReasoningEffort, pricing_version: PRICING_VERSION, service_tier: 'default' as const};
  return {...config, config_version: hash(config)};
}
export function authorizedBudget(): number {
  const budget = Number(process.env.KIARA_OPENAI_BUDGET_USD);
  if (!Number.isFinite(budget) || budget <= 0 || budget > AUTHORIZED_SPEND_CEILING_USD) {
    throw new AppError('OPENAI_BUDGET_REQUIRED','Configure an explicit positive server-side OpenAI budget no greater than the authorized $50 total.');
  }
  return budget;
}
/** Safe for readiness: this never reads credentials into returned records. */
export function runtimeConfigurationStatus() {
  let config: RuntimeConfig | null = null; let budget_usd: number | null = null; const blockers: string[] = [];
  if (!process.env.OPENAI_API_KEY) blockers.push('OPENAI_API_KEY_MISSING');
  try { config = runtimeConfig(); } catch { blockers.push('MODEL_POLICY_MISMATCH'); }
  try { budget_usd = authorizedBudget(); } catch { blockers.push('OPENAI_BUDGET_REQUIRED'); }
  return {credential_configured: Boolean(process.env.OPENAI_API_KEY), configuration: config, budget_usd, authorized_ceiling_usd: AUTHORIZED_SPEND_CEILING_USD, ready: blockers.length === 0, blockers, provider_execution_verified: false};
}
/** Conservative standard-tier accounting: no unverified cache discounts. */
export function tokenCost(model: string, input: number, output: number): number {
  const prices = Object.hasOwn(MODEL_PRICES,model)?MODEL_PRICES[model as SupportedModel]:undefined;
  if (!prices) throw new AppError('MODEL_POLICY_MISMATCH','No approved pricing exists for this model.');
  return (input * prices.input + output * prices.output) / 1_000_000;
}
