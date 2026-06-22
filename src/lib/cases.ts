import type {
  DepositVelocity,
  KycStatus,
  OperatorBonusPolicy,
  PlayerCase,
  PlayerSegment,
  VipTier,
  WageringStatus,
} from "./types";

export const BONUS_DEPOSIT_AMOUNT = 100;
export const BONUS_DEPOSIT_OPTIONS = [25, 50, 100, 250] as const;

const campaignStart = "2026-06-11T00:00:00.000Z";
const campaignEnd = "2026-07-19T23:59:59.000Z";

export const standardBonusPolicy: OperatorBonusPolicy = {
  policyId: "POL-WC26-MATCHDAY-2026",
  operatorId: "OP-BLOCKLABS-EU",
  operatorName: "BlockLabs Casino EU",
  eligibleSegments: ["Bronze", "Silver", "Gold", "Platinum"],
  minimumDeposit: 50,
  acceptedCurrencies: ["EUR"],
  campaignStart,
  campaignEnd,
  expiryGraceHours: 12,
  oneClaimOnly: true,
  blockFraudAt: "high",
  blockResponsibleGamingAt: "high",
  reopenWindowDays: 7,
};

export type PresetKey =
  | "eligible"
  | "expired"
  | "claimed"
  | "mismatch"
  | "wagering"
  | "blocked";

export type PresetCase = {
  key: PresetKey;
  label: string;
  intent: string;
  expectedOutcome: string[];
  case: PlayerCase;
};

type CaseOverrides = Partial<{
  playerId: string;
  complaintId: string;
  complaintTimestamp: string;
  vipTier: VipTier;
  playerSegment: PlayerSegment;
  lifetimeDeposits: number;
  last30DayDeposits: number;
  supportTickets30d: number;
  ageClaimed: number | null;
  idVerified: boolean;
  kycStatus: KycStatus;
  country: string;
  depositAmount: number;
  depositCurrency: string;
  depositTimestamp: string;
  recentWinnings30d: number;
  chargebacks: number;
  failedDeposits30d: number;
  playerEnteredBonusCode: string | null;
  priorClaimStatus: PlayerCase["bonusLedger"]["priorClaimStatus"];
  creditedAt: string | null;
  wageringStatus: WageringStatus;
  wageringProgressPercent: number;
  previousBonusClaims30d: number;
  vpnDetected: boolean;
  ipCountry: string;
  vpnExitCountry: string | null;
  deviceChanged: boolean;
  countryMismatch: boolean;
  duplicateAccountSuspected: boolean;
  nightSessions7d: number;
  depositVelocity: DepositVelocity;
  lossIncrease30d: boolean;
  selfExclusionHistory: boolean;
  reopenedWithinWindow: boolean;
}>;

function buildCase(overrides: CaseOverrides): PlayerCase {
  const country = overrides.country ?? "Malta";
  const depositTimestamp = overrides.depositTimestamp ?? "2026-06-14T10:30:00.000Z";
  const complaintTimestamp = overrides.complaintTimestamp ?? "2026-06-14T10:35:00.000Z";

  return {
    playerId: overrides.playerId ?? "P-BONUS-001",
    operator: {
      operatorId: standardBonusPolicy.operatorId,
      operatorName: standardBonusPolicy.operatorName,
      policy: standardBonusPolicy,
    },
    support: {
      complaintId: overrides.complaintId ?? "CS-BONUS-001",
      complaintTimestamp,
      issue: "missing_bonus",
      reopenedWithinWindow: overrides.reopenedWithinWindow ?? false,
    },
    crm: {
      vipTier: overrides.vipTier ?? "Bronze",
      playerSegment: overrides.playerSegment ?? "Bronze",
      lifetimeDeposits: overrides.lifetimeDeposits ?? 800,
      last30DayDeposits: overrides.last30DayDeposits ?? 300,
      supportTickets30d: overrides.supportTickets30d ?? 1,
    },
    kyc: {
      ageClaimed: overrides.ageClaimed ?? 24,
      idVerified: overrides.idVerified ?? true,
      kycStatus: overrides.kycStatus ?? "verified",
      country,
    },
    payments: {
      depositAmount: overrides.depositAmount ?? BONUS_DEPOSIT_AMOUNT,
      depositCurrency: overrides.depositCurrency ?? "EUR",
      depositTimestamp,
      recentWinnings30d: overrides.recentWinnings30d ?? 0,
      chargebacks: overrides.chargebacks ?? 0,
      failedDeposits30d: overrides.failedDeposits30d ?? 0,
    },
    campaign: {
      campaignId: "CMP-WC26-MATCHDAY",
      campaignName: "World Cup 2026 Matchday Bonus",
      bonusCode: "WORLD26",
      playerEnteredBonusCode: overrides.playerEnteredBonusCode ?? "WORLD26",
      wageringRequired: true,
    },
    bonusLedger: {
      priorClaimStatus: overrides.priorClaimStatus ?? "none",
      creditedAt: overrides.creditedAt ?? null,
      wageringStatus: overrides.wageringStatus ?? "complete",
      wageringProgressPercent: overrides.wageringProgressPercent ?? 100,
      previousBonusClaims30d: overrides.previousBonusClaims30d ?? 0,
    },
    risk: {
      vpnDetected: overrides.vpnDetected ?? false,
      ipCountry: overrides.ipCountry ?? country,
      vpnExitCountry: overrides.vpnExitCountry ?? null,
      deviceChanged: overrides.deviceChanged ?? false,
      countryMismatch: overrides.countryMismatch ?? false,
      duplicateAccountSuspected: overrides.duplicateAccountSuspected ?? false,
    },
    responsibleGaming: {
      nightSessions7d: overrides.nightSessions7d ?? 2,
      depositVelocity: overrides.depositVelocity ?? "low",
      lossIncrease30d: overrides.lossIncrease30d ?? false,
      selfExclusionHistory: overrides.selfExclusionHistory ?? false,
    },
  };
}

export const presetCases: PresetCase[] = [
  {
    key: "eligible",
    label: "Eligible Verified Player",
    intent: "The signal verifies the player, campaign, deposit, and ledger so the agent can resolve without a support queue.",
    expectedOutcome: [
      "Grant bonus",
      "Message player",
      "Mark ticket deflected",
    ],
    case: buildCase({
      playerId: "P-BONUS-ELIGIBLE-001",
      complaintId: "CS-BONUS-ELIGIBLE-001",
      vipTier: "Platinum",
      playerSegment: "Platinum",
      lifetimeDeposits: 52000,
      last30DayDeposits: 7000,
      supportTickets30d: 0,
      ageClaimed: 45,
      country: "United Kingdom",
      depositAmount: 100,
      recentWinnings30d: 6200,
      reopenedWithinWindow: false,
    }),
  },
  {
    key: "expired",
    label: "Campaign Expired",
    intent: "The complaint is valid to investigate, but the campaign window and grace period have already closed.",
    expectedOutcome: [
      "Do not grant bonus",
      "Message deterministic expiry reason",
      "Show active promotions",
    ],
    case: buildCase({
      playerId: "P-BONUS-EXPIRED-001",
      complaintId: "CS-BONUS-EXPIRED-001",
      complaintTimestamp: "2026-07-21T10:35:00.000Z",
      vipTier: "Silver",
      playerSegment: "Silver",
      lifetimeDeposits: 9000,
      last30DayDeposits: 1200,
      ageClaimed: 34,
      country: "Germany",
      depositAmount: 100,
      depositTimestamp: "2026-07-21T10:30:00.000Z",
      recentWinnings30d: 250,
    }),
  },
  {
    key: "claimed",
    label: "Already Claimed Bonus",
    intent: "The one-claim rule prevents duplicate crediting even when the player otherwise looks eligible.",
    expectedOutcome: [
      "Do not grant duplicate bonus",
      "Message prior-claim reason",
      "Create support resolution note",
    ],
    case: buildCase({
      playerId: "P-BONUS-CLAIMED-001",
      complaintId: "CS-BONUS-CLAIMED-001",
      vipTier: "Gold",
      playerSegment: "Gold",
      lifetimeDeposits: 22000,
      last30DayDeposits: 2400,
      ageClaimed: 39,
      country: "Malta",
      depositAmount: 100,
      recentWinnings30d: 1400,
      priorClaimStatus: "credited",
      creditedAt: "2026-06-14T10:42:00.000Z",
      previousBonusClaims30d: 1,
    }),
  },
  {
    key: "mismatch",
    label: "Deposit / Code Mismatch",
    intent: "Campaign policy requires the right bonus code, currency, and minimum deposit before any bonus can be credited.",
    expectedOutcome: [
      "Do not grant bonus",
      "Message deterministic mismatch reason",
      "Show active promotions",
    ],
    case: buildCase({
      playerId: "P-BONUS-MISMATCH-001",
      complaintId: "CS-BONUS-MISMATCH-001",
      vipTier: "Bronze",
      playerSegment: "Bronze",
      lifetimeDeposits: 1300,
      last30DayDeposits: 180,
      supportTickets30d: 1,
      ageClaimed: 28,
      country: "Spain",
      depositAmount: 25,
      playerEnteredBonusCode: "GROUPSTAGE50",
      recentWinnings30d: 0,
    }),
  },
  {
    key: "wagering",
    label: "Wagering Incomplete",
    intent: "Eligibility can be denied from ledger state without asking AI to infer bonus terms.",
    expectedOutcome: [
      "Do not grant bonus",
      "Message wagering status",
      "Create support resolution note",
    ],
    case: buildCase({
      playerId: "P-BONUS-WAGERING-001",
      complaintId: "CS-BONUS-WAGERING-001",
      vipTier: "Silver",
      playerSegment: "Silver",
      lifetimeDeposits: 7600,
      last30DayDeposits: 950,
      supportTickets30d: 1,
      ageClaimed: 31,
      country: "Malta",
      depositAmount: 100,
      wageringStatus: "incomplete",
      wageringProgressPercent: 42,
      recentWinnings30d: 500,
    }),
  },
  {
    key: "blocked",
    label: "Risk or RG Blocked",
    intent: "Risk and player-safety controls prevent autonomous promotional resolution.",
    expectedOutcome: [
      "Do not grant bonus",
      "Create human escalation",
      "Pause promotions",
    ],
    case: buildCase({
      playerId: "P-BONUS-BLOCKED-001",
      complaintId: "CS-BONUS-BLOCKED-001",
      vipTier: "Silver",
      playerSegment: "Silver",
      lifetimeDeposits: 8000,
      last30DayDeposits: 5000,
      supportTickets30d: 2,
      ageClaimed: 29,
      country: "Malta",
      depositAmount: 100,
      failedDeposits30d: 2,
      nightSessions7d: 14,
      depositVelocity: "high",
      lossIncrease30d: true,
    }),
  },
];

const vipTiers: VipTier[] = ["None", "Bronze", "Silver", "Gold", "Platinum"];
const statuses: KycStatus[] = ["verified", "pending", "failed"];
const velocities: DepositVelocity[] = ["low", "medium", "high"];
const countries = ["Malta", "Germany", "Netherlands", "United Kingdom", "Spain"];
const wagerStatuses: WageringStatus[] = ["complete", "incomplete", "not_started"];

function choose<T>(values: T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function chooseDifferent(values: string[], current: string): string {
  return choose(values.filter((value) => value !== current));
}

function intBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function maybe(probability: number): boolean {
  return Math.random() < probability;
}

function segmentFromTier(vipTier: VipTier): PlayerSegment {
  return vipTier === "None" ? "Standard" : vipTier;
}

export function cloneCase(playerCase: PlayerCase): PlayerCase {
  return structuredClone(playerCase);
}

export function withBonusDepositAmount(playerCase: PlayerCase, amount: number): PlayerCase {
  const nextCase = cloneCase(playerCase);
  nextCase.payments.depositAmount = amount;
  return nextCase;
}

export function getPresetCase(key: PresetKey): PlayerCase {
  const preset = presetCases.find((item) => item.key === key) ?? presetCases[0];
  return cloneCase(preset.case);
}

export function generateRandomCase(): PlayerCase {
  const vipTier = choose(vipTiers);
  const playerSegment = segmentFromTier(vipTier);
  const kycStatus = Math.random() < 0.72 ? "verified" : choose(statuses);
  const highRiskPattern = Math.random() < 0.32;
  const responsibleGamingPattern = Math.random() < 0.28;
  const country = choose(countries);
  const vpnDetected = maybe(highRiskPattern ? 0.68 : 0.14);
  const countryMismatch = maybe(highRiskPattern ? 0.48 : 0.1);
  const ipCountry = countryMismatch ? chooseDifferent(countries, country) : country;
  const age =
    kycStatus === "pending" && Math.random() < 0.18
      ? null
      : intBetween(highRiskPattern ? 17 : 21, 64);

  const lifetimeDeposits =
    vipTier === "Platinum"
      ? intBetween(28000, 65000)
      : vipTier === "Gold"
        ? intBetween(12000, 26000)
        : vipTier === "Silver"
          ? intBetween(5000, 11000)
          : intBetween(250, 4500);

  return buildCase({
    playerId: `P-${intBetween(1000, 9999)}-${Date.now().toString().slice(-4)}`,
    complaintId: `CS-BONUS-${intBetween(1000, 9999)}`,
    vipTier,
    playerSegment,
    lifetimeDeposits,
    last30DayDeposits: intBetween(100, Math.max(600, Math.floor(lifetimeDeposits / 5))),
    supportTickets30d: intBetween(0, highRiskPattern ? 6 : 2),
    kycStatus,
    ageClaimed: age,
    idVerified: kycStatus === "verified" && !maybe(0.08),
    country,
    depositAmount: choose([...BONUS_DEPOSIT_OPTIONS]),
    recentWinnings30d: intBetween(0, highRiskPattern ? 4200 : 7000),
    chargebacks: intBetween(0, highRiskPattern ? 4 : 1),
    failedDeposits30d: intBetween(0, highRiskPattern ? 5 : 1),
    priorClaimStatus: maybe(0.12) ? "claimed" : "none",
    wageringStatus: choose(wagerStatuses),
    wageringProgressPercent: intBetween(0, 100),
    previousBonusClaims30d: intBetween(0, highRiskPattern ? 5 : 2),
    vpnDetected,
    ipCountry,
    vpnExitCountry: vpnDetected ? ipCountry : null,
    deviceChanged: maybe(highRiskPattern ? 0.58 : 0.18),
    countryMismatch,
    duplicateAccountSuspected: maybe(highRiskPattern ? 0.42 : 0.05),
    nightSessions7d: intBetween(0, responsibleGamingPattern ? 18 : 7),
    depositVelocity: responsibleGamingPattern ? choose(["medium", "high"]) : choose(velocities),
    lossIncrease30d: maybe(responsibleGamingPattern ? 0.74 : 0.18),
    selfExclusionHistory: maybe(responsibleGamingPattern ? 0.22 : 0.03),
    reopenedWithinWindow: maybe(0.1),
  });
}
