import type {
  BonusEligibilityOutcomeCode,
  PlayerCase,
  Signal,
  SignalFactor,
  SignalSeverity,
} from "./types";

const severityRank: Record<SignalSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function severityFromScore(score: number): SignalSeverity {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function levelFromScore(score: number): SignalSeverity {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function factor(name: string, score?: number): SignalFactor {
  return score === undefined ? { name } : { name, score };
}

function money(amount: number, currency = "EUR") {
  return `${currency} ${amount.toLocaleString()}`;
}

function labelSeverity(severity: SignalSeverity): string {
  return severity[0].toUpperCase() + severity.slice(1);
}

function makeSignal(input: Omit<Signal, "value">): Signal {
  return {
    ...input,
    value: `${labelSeverity(input.severity)} (${input.score})`,
  };
}

function policyDate(value: string): number {
  return new Date(value).getTime();
}

function policyEndWithGrace(playerCase: PlayerCase): number {
  const end = policyDate(playerCase.operator.policy.campaignEnd);
  return end + playerCase.operator.policy.expiryGraceHours * 60 * 60 * 1000;
}

export function isAtLeast(
  signal: Signal,
  severity: SignalSeverity,
): boolean {
  return severityRank[signal.severity] >= severityRank[severity];
}

export function isDecisionSignal(): boolean {
  return false;
}

export function getSourceSignals(signals: Signal[]): Signal[] {
  return signals;
}

export function getDecisionSignals(): Signal[] {
  return [];
}

export function getSignal(signals: Signal[], name: string): Signal {
  const signal = signals.find((item) => item.name === name);
  if (!signal) {
    throw new Error(`Missing signal: ${name}`);
  }
  return signal;
}

export function calculateIdentityConfidence(playerCase: PlayerCase): Signal {
  const factors: SignalFactor[] = [factor("Identity confidence baseline", 30)];
  let score = 30;

  if (playerCase.kyc.kycStatus === "verified") {
    score += 45;
    factors.push(factor("KYC status = verified", 45));
  } else if (playerCase.kyc.kycStatus === "pending") {
    score += 20;
    factors.push(factor("KYC status = pending", 20));
  } else {
    factors.push(factor("KYC status = failed", 0));
  }

  if (playerCase.kyc.idVerified) {
    score += 15;
    factors.push(factor("ID document verified", 15));
  } else {
    factors.push(factor("ID document not verified", 0));
  }

  if (playerCase.kyc.ageClaimed !== null) {
    score += 5;
    factors.push(factor(`Claimed age present = ${playerCase.kyc.ageClaimed}`, 5));
  } else {
    factors.push(factor("Claimed age missing", 0));
  }

  score = clampScore(score);
  const explanation = [
    score >= 75
      ? "Identity data is strong enough for governed agent consumption."
      : "Identity data is incomplete or unresolved.",
  ];

  return makeSignal({
    name: "Identity Confidence",
    score,
    severity: levelFromScore(score),
    confidence: 0.96,
    definition: "Scores how confidently the platform knows the player's verified identity.",
    sources: ["KYC"],
    owner: "Compliance Team",
    version: "v1.0",
    usedBy: ["Bonus Resolution Agent", "Support Agent", "Fraud Agent"],
    explanation,
    factors,
  });
}

export function calculateUnderageRisk(playerCase: PlayerCase): Signal {
  const { ageClaimed, idVerified, kycStatus } = playerCase.kyc;
  let severity: SignalSeverity = "low";
  let score = 10;
  const factors: SignalFactor[] = [];
  let reason = "Adult age and KYC state do not indicate underage risk.";

  if (kycStatus === "failed") {
    severity = "critical";
    score = 100;
    reason = "KYC failed, so bonus automation must stop.";
    factors.push(factor("KYC status = failed", 100));
  } else if (ageClaimed !== null && ageClaimed < 18) {
    severity = "critical";
    score = 100;
    reason = "Claimed age is below the legal adult threshold.";
    factors.push(factor(`Age ${ageClaimed} is below 18`, 100));
  } else if (ageClaimed === null && kycStatus === "pending") {
    severity = "high";
    score = 80;
    reason = "Age is missing while KYC is still pending.";
    factors.push(factor("Age missing with pending KYC", 80));
  } else if (
    ageClaimed !== null &&
    ageClaimed >= 18 &&
    ageClaimed <= 20 &&
    kycStatus === "pending"
  ) {
    severity = "medium";
    score = 55;
    reason = "Young adult profile with pending identity checks.";
    factors.push(factor(`Age ${ageClaimed} with pending KYC`, 55));
  } else {
    factors.push(factor(ageClaimed === null ? "Age missing" : `Age ${ageClaimed}`));
    factors.push(factor(`KYC status = ${kycStatus}`));
  }

  factors.push(factor(idVerified ? "ID verified" : "ID not verified"));

  return makeSignal({
    name: "Underage Risk",
    score,
    severity,
    confidence: 0.97,
    definition: "Detects underage or unresolved age/KYC risk before promotional crediting.",
    sources: ["KYC"],
    owner: "Compliance Team",
    version: "v1.0",
    usedBy: ["Bonus Resolution Agent", "Support Agent", "Fraud Agent"],
    explanation: [reason],
    factors,
  });
}

export function calculatePlayerValue(playerCase: PlayerCase): Signal {
  const { vipTier, lifetimeDeposits, last30DayDeposits } = playerCase.crm;
  let severity: SignalSeverity = "low";
  let score = 20;
  let mappedReason = "Player does not qualify for elevated commercial value.";

  if (vipTier === "Platinum" || lifetimeDeposits > 25000) {
    severity = "high";
    score = 90;
    mappedReason = "Player qualifies as Platinum or equivalent high-value customer.";
  } else if (vipTier === "Gold" || lifetimeDeposits > 10000) {
    severity = "high";
    score = 75;
    mappedReason = "Player qualifies as Gold or equivalent high-value customer.";
  } else if (vipTier === "Silver" || lifetimeDeposits > 5000) {
    severity = "medium";
    score = 55;
    mappedReason = "Player qualifies as Silver or equivalent medium-value customer.";
  }

  return makeSignal({
    name: "Player Value",
    score,
    severity,
    confidence: 0.95,
    definition: "Classifies commercial player value using CRM segment and deposit history.",
    sources: ["CRM"],
    owner: "CRM Team",
    version: "v1.0",
    usedBy: ["Bonus Resolution Agent", "Support Agent", "Retention Agent"],
    explanation: [mappedReason],
    factors: [
      factor(`Player Segment = ${playerCase.crm.playerSegment}`),
      factor(`VIP Tier = ${vipTier}`),
      factor(`Lifetime Deposits = ${money(lifetimeDeposits)}`),
      factor(`Last 30-day Deposits = ${money(last30DayDeposits)}`),
      factor(`Value rule maps to ${score}`),
    ],
  });
}

export function calculateFraudRisk(playerCase: PlayerCase): Signal {
  const factors: SignalFactor[] = [];
  let score = 0;

  if (playerCase.payments.chargebacks > 1) {
    score += 30;
    factors.push(factor("Chargebacks > 1", 30));
  }
  if (playerCase.risk.vpnDetected) {
    score += 20;
    factors.push(factor(`VPN detected (${playerCase.risk.vpnExitCountry ?? "unknown"} exit)`, 20));
  }
  if (playerCase.risk.deviceChanged) {
    score += 15;
    factors.push(factor("Device changed", 15));
  }
  if (playerCase.risk.countryMismatch) {
    score += 20;
    factors.push(factor(`Country mismatch: KYC ${playerCase.kyc.country} vs IP ${playerCase.risk.ipCountry}`, 20));
  }
  if (playerCase.risk.duplicateAccountSuspected) {
    score += 25;
    factors.push(factor("Duplicate account suspected", 25));
  }
  if (playerCase.bonusLedger.previousBonusClaims30d > 3) {
    score += 15;
    factors.push(factor("Previous bonus claims 30d > 3", 15));
  }

  score = clampScore(score);
  if (factors.length === 0) {
    factors.push(factor("No weighted fraud indicators", 0));
  }

  return makeSignal({
    name: "Fraud Risk",
    score,
    severity: severityFromScore(score),
    confidence: 0.93,
    definition: "Weighted fraud score from payment history, login context, account-risk events, and bonus claim activity.",
    sources: ["Payments", "Risk", "Bonus Ledger", "Login"],
    owner: "Risk Team",
    version: "v1.0",
    usedBy: ["Bonus Resolution Agent", "Fraud Agent"],
    explanation: [
      score === 0
        ? "No weighted fraud indicators are active."
        : "Multiple deterministic fraud indicators are active.",
    ],
    factors,
  });
}

export function calculateResponsibleGamingRisk(playerCase: PlayerCase): Signal {
  const factors: SignalFactor[] = [];
  let score = 0;

  if (playerCase.responsibleGaming.nightSessions7d > 10) {
    score += 20;
    factors.push(factor("Night sessions 7d > 10", 20));
  }
  if (playerCase.responsibleGaming.depositVelocity === "high") {
    score += 30;
    factors.push(factor("Deposit velocity = high", 30));
  }
  if (playerCase.responsibleGaming.lossIncrease30d) {
    score += 25;
    factors.push(factor("Loss increase 30d", 25));
  }
  if (playerCase.responsibleGaming.selfExclusionHistory) {
    score += 40;
    factors.push(factor("Self-exclusion history", 40));
  }

  score = clampScore(score);
  if (factors.length === 0) {
    factors.push(factor("No weighted responsible-gaming indicators", 0));
  }

  return makeSignal({
    name: "Responsible Gaming Risk",
    score,
    severity: severityFromScore(score),
    confidence: 0.91,
    definition: "Weighted player-safety score from session timing, deposit velocity, losses, and self-exclusion history.",
    sources: ["Responsible Gaming", "Payments", "Casino Activity"],
    owner: "Responsible Gaming Team",
    version: "v1.0",
    usedBy: ["Bonus Resolution Agent", "Support Agent", "Retention Agent"],
    explanation: [
      score === 0
        ? "Responsible-gaming indicators are low."
        : "Responsible-gaming indicators require safety review.",
    ],
    factors,
  });
}

export function calculateBonusEligibilitySignal(
  playerCase: PlayerCase,
  identityConfidence: Signal,
  underageRisk: Signal,
  fraudRisk: Signal,
  responsibleGamingRisk: Signal,
  playerValue: Signal,
): Signal {
  const policy = playerCase.operator.policy;
  const factors: SignalFactor[] = [
    factor(`Operator policy = ${policy.policyId}`),
    factor(`Campaign = ${playerCase.campaign.campaignId}`),
  ];
  let outcomeCode: BonusEligibilityOutcomeCode = "BONUS_CREDIT_VERIFIED";
  let score = 95;
  let severity: SignalSeverity = "high";
  let reason = "Deposit, campaign, player segment, and ledger state verify bonus eligibility.";

  const complaintTime = policyDate(playerCase.support.complaintTimestamp);
  const depositTime = policyDate(playerCase.payments.depositTimestamp);
  const campaignStart = policyDate(policy.campaignStart);
  const campaignEndWithGrace = policyEndWithGrace(playerCase);
  const enteredCode = playerCase.campaign.playerEnteredBonusCode;

  if (underageRisk.severity === "critical" || playerCase.kyc.kycStatus === "failed") {
    outcomeCode = "BONUS_CREDIT_BLOCKED_RISK";
    score = 0;
    severity = "critical";
    reason = "Compliance or age risk blocks bonus crediting.";
    factors.push(factor(`Underage Risk = ${underageRisk.severity} (${underageRisk.score})`, -100));
  } else if (isAtLeast(fraudRisk, policy.blockFraudAt)) {
    outcomeCode = "BONUS_CREDIT_BLOCKED_RISK";
    score = 0;
    severity = "critical";
    reason = "Fraud controls block automated bonus crediting.";
    factors.push(factor(`Fraud Risk = ${fraudRisk.severity} (${fraudRisk.score})`, -100));
  } else if (isAtLeast(responsibleGamingRisk, policy.blockResponsibleGamingAt)) {
    outcomeCode = "BONUS_CREDIT_BLOCKED_RG";
    score = 0;
    severity = "critical";
    reason = "Responsible-gaming controls block promotional crediting.";
    factors.push(factor(`Responsible Gaming Risk = ${responsibleGamingRisk.severity} (${responsibleGamingRisk.score})`, -100));
  } else if (identityConfidence.severity === "low") {
    outcomeCode = "BONUS_CREDIT_UNCERTAIN";
    score = 25;
    severity = "medium";
    reason = "Identity confidence is too low for automated bonus resolution.";
    factors.push(factor(`Identity Confidence = ${identityConfidence.severity} (${identityConfidence.score})`, -70));
  } else if (complaintTime > campaignEndWithGrace || depositTime > campaignEndWithGrace) {
    outcomeCode = "BONUS_CREDIT_DENIED_EXPIRED";
    score = 15;
    severity = "medium";
    reason = "The bonus complaint or qualifying deposit is outside the campaign window and grace period.";
    factors.push(factor(`Campaign ended = ${policy.campaignEnd}`));
    factors.push(factor(`Grace hours = ${policy.expiryGraceHours}`));
  } else if (policy.oneClaimOnly && playerCase.bonusLedger.priorClaimStatus !== "none") {
    outcomeCode = "BONUS_CREDIT_DENIED_ALREADY_CLAIMED";
    score = 20;
    severity = "medium";
    reason = "Bonus ledger shows the player has already claimed or received this campaign bonus.";
    factors.push(factor(`Prior claim status = ${playerCase.bonusLedger.priorClaimStatus}`));
  } else if (
    depositTime < campaignStart ||
    playerCase.payments.depositAmount < policy.minimumDeposit ||
    !policy.acceptedCurrencies.includes(playerCase.payments.depositCurrency) ||
    !policy.eligibleSegments.includes(playerCase.crm.playerSegment) ||
    enteredCode !== playerCase.campaign.bonusCode
  ) {
    outcomeCode = "BONUS_CREDIT_DENIED_DEPOSIT_MISMATCH";
    score = 30;
    severity = "medium";
    reason = "Deposit, currency, segment, timing, or bonus-code data does not match campaign policy.";
    factors.push(factor(`Deposit = ${money(playerCase.payments.depositAmount, playerCase.payments.depositCurrency)}`));
    factors.push(factor(`Minimum deposit = ${money(policy.minimumDeposit)}`));
    factors.push(factor(`Player segment = ${playerCase.crm.playerSegment}`));
    factors.push(factor(`Entered bonus code = ${enteredCode ?? "missing"}`));
  } else if (
    playerCase.campaign.wageringRequired &&
    playerCase.bonusLedger.wageringStatus !== "complete"
  ) {
    outcomeCode = "BONUS_CREDIT_DENIED_WAGERING_INCOMPLETE";
    score = 40;
    severity = "medium";
    reason = "Wagering requirements are not complete for the requested bonus credit.";
    factors.push(factor(`Wagering status = ${playerCase.bonusLedger.wageringStatus}`));
    factors.push(factor(`Wagering progress = ${playerCase.bonusLedger.wageringProgressPercent}%`));
  } else {
    factors.push(factor(`Deposit = ${money(playerCase.payments.depositAmount, playerCase.payments.depositCurrency)}`, 25));
    factors.push(factor(`Campaign code matched = ${playerCase.campaign.bonusCode}`, 25));
    factors.push(factor(`Player segment eligible = ${playerCase.crm.playerSegment}`, 20));
    factors.push(factor(`Ledger prior claim status = none`, 15));
    factors.push(factor(`Wagering status = ${playerCase.bonusLedger.wageringStatus}`, 10));
  }

  return makeSignal({
    name: "Bonus Eligibility Signal",
    score,
    severity,
    confidence: 0.94,
    definition: "Governed outcome for missing-bonus complaints using operator policy, campaign data, deposit data, ledger state, identity, risk, and responsible-gaming controls.",
    sources: ["Operator Policy", "Campaign", "Payments", "Bonus Ledger", "CRM", "KYC", "Risk", "Responsible Gaming"],
    owner: "CRM Promotions Team",
    version: "v1.0",
    usedBy: ["Bonus Resolution Agent", "Support Agent", "Retention Agent", "Fraud Agent"],
    explanation: [reason, `Outcome code: ${outcomeCode}.`],
    factors: [
      ...factors,
      factor(`Player Value = ${playerValue.severity} (${playerValue.score})`),
      factor(`Outcome code = ${outcomeCode}`),
    ],
    outcomeCode,
  });
}

export function calculateSignals(playerCase: PlayerCase): Signal[] {
  const identityConfidence = calculateIdentityConfidence(playerCase);
  const underageRisk = calculateUnderageRisk(playerCase);
  const fraudRisk = calculateFraudRisk(playerCase);
  const responsibleGamingRisk = calculateResponsibleGamingRisk(playerCase);
  const playerValue = calculatePlayerValue(playerCase);
  const bonusEligibility = calculateBonusEligibilitySignal(
    playerCase,
    identityConfidence,
    underageRisk,
    fraudRisk,
    responsibleGamingRisk,
    playerValue,
  );

  return [
    identityConfidence,
    underageRisk,
    fraudRisk,
    responsibleGamingRisk,
    playerValue,
    bonusEligibility,
  ];
}

export function calculateSourceSignals(playerCase: PlayerCase): Signal[] {
  return calculateSignals(playerCase);
}

export function ensureDecisionSignals(
  playerCase: PlayerCase,
  signals: Signal[],
): Signal[] {
  if (signals.some((signal) => signal.name === "Bonus Eligibility Signal")) {
    return signals;
  }

  const sourceSignals = signals.length ? signals : calculateSignals(playerCase);
  const identityConfidence = getSignal(sourceSignals, "Identity Confidence");
  const underageRisk = getSignal(sourceSignals, "Underage Risk");
  const fraudRisk = getSignal(sourceSignals, "Fraud Risk");
  const responsibleGamingRisk = getSignal(sourceSignals, "Responsible Gaming Risk");
  const playerValue = getSignal(sourceSignals, "Player Value");

  return [
    ...sourceSignals,
    calculateBonusEligibilitySignal(
      playerCase,
      identityConfidence,
      underageRisk,
      fraudRisk,
      responsibleGamingRisk,
      playerValue,
    ),
  ];
}
