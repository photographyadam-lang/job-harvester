/**
 * Token-count to USD cost conversion for DeepSeek Chat.
 *
 * Pricing (as of 2025):
 *   - Input:  $0.14 per 1M tokens
 *   - Output: $0.28 per 1M tokens
 *
 * All LLM cost tracking in the pipeline funnels through this module.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INPUT_PRICE_PER_1M  = 0.14;
const OUTPUT_PRICE_PER_1M = 0.28;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface CostBreakdown {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate USD cost from token counts.
 *
 * @param usage - Object containing `promptTokens` and `completionTokens`.
 * @returns A breakdown with input, output, and total costs in USD.
 */
export function estimateCost(usage: TokenUsage): CostBreakdown {
  const inputCostUsd  = (usage.promptTokens / 1_000_000) * INPUT_PRICE_PER_1M;
  const outputCostUsd = (usage.completionTokens / 1_000_000) * OUTPUT_PRICE_PER_1M;

  return {
    inputCostUsd:  round(inputCostUsd),
    outputCostUsd: round(outputCostUsd),
    totalCostUsd:  round(inputCostUsd + outputCostUsd),
  };
}

/**
 * Round a number to 6 decimal places (sub-cent precision).
 */
function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
