export const PAYLOAD_BASELINE_BYTES = 1_572_864;
export const PAYLOAD_PENALTY_PER_500KB = 0.5;
export const THIRD_PARTY_SCRIPT_BASELINE = 5;
export const THIRD_PARTY_PENALTY_PER_5_SCRIPTS = 0.3;

const BYTES_PER_500KB = 500 * 1024;

export interface BloatPenalty {
  payloadPenaltyPercent: number;
  thirdPartyPenaltyPercent: number;
  totalPenaltyPercent: number;
}

export function computePayloadPenalty(totalPayloadBytes: number): number {
  const excessBytes = Math.max(0, totalPayloadBytes - PAYLOAD_BASELINE_BYTES);
  return (excessBytes / BYTES_PER_500KB) * PAYLOAD_PENALTY_PER_500KB;
}

export function computeThirdPartyPenalty(scriptCount: number): number {
  const beyondBaseline = Math.max(0, scriptCount - THIRD_PARTY_SCRIPT_BASELINE);
  const groups = Math.ceil(beyondBaseline / 5);
  return groups * THIRD_PARTY_PENALTY_PER_5_SCRIPTS;
}

export function computeBloatPenalty(totalPayloadBytes: number, thirdPartyScriptCount: number): BloatPenalty {
  const payloadPenaltyPercent = computePayloadPenalty(totalPayloadBytes);
  const thirdPartyPenaltyPercent = computeThirdPartyPenalty(thirdPartyScriptCount);
  return {
    payloadPenaltyPercent,
    thirdPartyPenaltyPercent,
    totalPenaltyPercent: payloadPenaltyPercent + thirdPartyPenaltyPercent,
  };
}