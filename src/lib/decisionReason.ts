import type { AgentDecision, BonusEligibilityOutcomeCode, PlayerCase, Signal } from "./types";

export function bonusOutcomeCode(signals: Signal[]): BonusEligibilityOutcomeCode {
  const signal = signals.find((item) => item.name === "Bonus Eligibility Signal");
  if (!signal?.outcomeCode) {
    throw new Error("Missing Bonus Eligibility Signal outcome code.");
  }
  return signal.outcomeCode;
}

export function bonusOutcomeLabel(outcomeCode: BonusEligibilityOutcomeCode): string {
  return outcomeCode
    .replace(/^BONUS_CREDIT_/, "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function isAutomatableDenial(outcomeCode: BonusEligibilityOutcomeCode): boolean {
  return [
    "BONUS_CREDIT_DENIED_EXPIRED",
    "BONUS_CREDIT_DENIED_ALREADY_CLAIMED",
    "BONUS_CREDIT_DENIED_DEPOSIT_MISMATCH",
    "BONUS_CREDIT_DENIED_WAGERING_INCOMPLETE",
  ].includes(outcomeCode);
}

export function buildPlayerMessage(outcomeCode: BonusEligibilityOutcomeCode, playerCase: PlayerCase): string {
  switch (outcomeCode) {
    case "BONUS_CREDIT_VERIFIED":
      return `I've verified your ${playerCase.campaign.campaignName} deposit and credited the bonus to your account.`;
    case "BONUS_CREDIT_DENIED_EXPIRED":
      return "The campaign has ended, so this bonus can no longer be credited. I can show you the current active promotions.";
    case "BONUS_CREDIT_DENIED_ALREADY_CLAIMED":
      return "Our records show this campaign bonus has already been claimed or credited on your account.";
    case "BONUS_CREDIT_DENIED_DEPOSIT_MISMATCH":
      return "The deposit or bonus code does not match the campaign eligibility rules for this promotion.";
    case "BONUS_CREDIT_DENIED_WAGERING_INCOMPLETE":
      return "The wagering requirement is not complete yet, so this bonus cannot be credited automatically.";
    case "BONUS_CREDIT_BLOCKED_RG":
      return "I need to pass this to our player-safety team before any promotional action can continue.";
    case "BONUS_CREDIT_BLOCKED_RISK":
    case "BONUS_CREDIT_UNCERTAIN":
      return "I need to pass this to a support specialist for review before any bonus can be credited.";
  }
}

export function buildHumanDecisionReason(
  status: AgentDecision["status"],
  playerCase: PlayerCase,
  signals: Signal[],
): string {
  const outcomeCode = bonusOutcomeCode(signals);

  if (status === "bonus_granted") {
    return [
      "Bonus eligibility was verified by the governed signal.",
      "The campaign, deposit, segment, and ledger checks passed.",
      "Bonus can be credited automatically.",
    ].join("\n");
  }

  if (status === "denied") {
    switch (outcomeCode) {
      case "BONUS_CREDIT_DENIED_EXPIRED":
        return [
          "Campaign eligibility window has closed.",
          "Bonus cannot be credited automatically.",
          "Offer current active promotions instead.",
        ].join("\n");
      case "BONUS_CREDIT_DENIED_ALREADY_CLAIMED":
        return [
          "Bonus ledger shows this campaign was already claimed.",
          "Duplicate credit must be prevented.",
          "Explain the ledger result to the player.",
        ].join("\n");
      case "BONUS_CREDIT_DENIED_DEPOSIT_MISMATCH":
        return [
          "Deposit, bonus code, currency, or segment does not match campaign policy.",
          "Bonus cannot be credited automatically.",
          "Explain the deterministic eligibility mismatch.",
        ].join("\n");
      case "BONUS_CREDIT_DENIED_WAGERING_INCOMPLETE":
        return [
          "Wagering requirement is incomplete.",
          "Bonus cannot be credited automatically.",
          "Explain what requirement remains.",
        ].join("\n");
      default:
        return [
          "Bonus eligibility was not verified.",
          "Automated crediting is not safe.",
          "Manual review may be required.",
        ].join("\n");
    }
  }

  if (status === "responsible_gaming_review") {
    return [
      "Player-safety indicators require review.",
      "Promotional activity should be paused.",
      "Human escalation required.",
    ].join("\n");
  }

  if (status === "kyc_required") {
    return [
      "Identity or age verification is incomplete.",
      "Bonus crediting cannot continue automatically.",
      "KYC review required.",
    ].join("\n");
  }

  if (outcomeCode === "BONUS_CREDIT_BLOCKED_RISK") {
    return [
      "Risk controls blocked automated bonus crediting.",
      "A specialist must review the complaint.",
      "Do not grant bonus automatically.",
    ].join("\n");
  }

  return [
    "Bonus eligibility is uncertain.",
    "The agent cannot safely resolve the complaint automatically.",
    "Human escalation required.",
  ].join("\n");
}
