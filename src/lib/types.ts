export type VipTier = "None" | "Bronze" | "Silver" | "Gold" | "Platinum";

export type PlayerSegment = "Standard" | "Bronze" | "Silver" | "Gold" | "Platinum";

export type KycStatus = "verified" | "pending" | "failed";

export type DepositVelocity = "low" | "medium" | "high";

export type WageringStatus = "complete" | "incomplete" | "not_started";

export type BonusClaimStatus = "none" | "claimed" | "credited";

export type BonusEligibilityOutcomeCode =
  | "BONUS_CREDIT_VERIFIED"
  | "BONUS_CREDIT_DENIED_EXPIRED"
  | "BONUS_CREDIT_DENIED_ALREADY_CLAIMED"
  | "BONUS_CREDIT_DENIED_DEPOSIT_MISMATCH"
  | "BONUS_CREDIT_DENIED_WAGERING_INCOMPLETE"
  | "BONUS_CREDIT_BLOCKED_RISK"
  | "BONUS_CREDIT_BLOCKED_RG"
  | "BONUS_CREDIT_UNCERTAIN";

export type OperatorBonusPolicy = {
  policyId: string;
  operatorId: string;
  operatorName: string;
  eligibleSegments: PlayerSegment[];
  minimumDeposit: number;
  acceptedCurrencies: string[];
  campaignStart: string;
  campaignEnd: string;
  expiryGraceHours: number;
  oneClaimOnly: boolean;
  blockFraudAt: "high" | "critical";
  blockResponsibleGamingAt: "high" | "critical";
  reopenWindowDays: number;
};

export type PlayerCase = {
  playerId: string;
  operator: {
    operatorId: string;
    operatorName: string;
    policy: OperatorBonusPolicy;
  };
  support: {
    complaintId: string;
    complaintTimestamp: string;
    issue: "missing_bonus";
    reopenedWithinWindow: boolean;
  };
  crm: {
    vipTier: VipTier;
    playerSegment: PlayerSegment;
    lifetimeDeposits: number;
    last30DayDeposits: number;
    supportTickets30d: number;
  };
  kyc: {
    ageClaimed: number | null;
    idVerified: boolean;
    kycStatus: KycStatus;
    country: string;
  };
  payments: {
    depositAmount: number;
    depositCurrency: string;
    depositTimestamp: string;
    recentWinnings30d: number;
    chargebacks: number;
    failedDeposits30d: number;
  };
  campaign: {
    campaignId: string;
    campaignName: string;
    bonusCode: string;
    playerEnteredBonusCode: string | null;
    wageringRequired: boolean;
  };
  bonusLedger: {
    priorClaimStatus: BonusClaimStatus;
    creditedAt: string | null;
    wageringStatus: WageringStatus;
    wageringProgressPercent: number;
    previousBonusClaims30d: number;
  };
  risk: {
    vpnDetected: boolean;
    ipCountry: string;
    vpnExitCountry: string | null;
    deviceChanged: boolean;
    countryMismatch: boolean;
    duplicateAccountSuspected: boolean;
  };
  responsibleGaming: {
    nightSessions7d: number;
    depositVelocity: DepositVelocity;
    lossIncrease30d: boolean;
    selfExclusionHistory: boolean;
  };
};

export type SignalSeverity = "low" | "medium" | "high" | "critical";

export type SignalFactor = {
  name: string;
  score?: number;
};

export type Signal = {
  name: string;
  value: string;
  score: number;
  severity: SignalSeverity;
  confidence: number;
  definition: string;
  sources: string[];
  owner: string;
  version: string;
  usedBy: string[];
  explanation: string[];
  factors: SignalFactor[];
  outcomeCode?: BonusEligibilityOutcomeCode;
};

export type AgentMemory = {
  playerId: string;
  previousDecisions: string[];
  previousActions: string[];
  notes: string[];
};

export type TraceEvent = {
  id: string;
  timestamp: string;
  type:
    | "case_generated"
    | "signal_calculated"
    | "agent_started"
    | "tool_called"
    | "guardrail_triggered"
    | "decision_made"
    | "action_completed"
    | "agent_finished"
    | "metrics_recorded"
    | "error";
  title: string;
  detail: string;
  data?: unknown;
};

export type ToolCallLog = {
  id: string;
  timestamp: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  status: "success" | "failure";
};

export type AgentDecision = {
  status:
    | "bonus_granted"
    | "denied"
    | "human_escalation"
    | "kyc_required"
    | "responsible_gaming_review";
  summary: string;
  primaryReason: string;
  actionsTaken: string[];
  blockedActions: string[];
  signalsUsed: string[];
  toolCalls: ToolCallLog[];
};

export type OutcomeMetrics = {
  deflected: boolean;
  reopened: boolean;
  timeToResolveMs: number;
  resolutionOutcome: AgentDecision["status"];
  signalOutcomeCode: BonusEligibilityOutcomeCode;
  humanEscalated: boolean;
  bonusGranted: boolean;
  playerMessageSent: boolean;
};

export type AgentRunResult = {
  executionMode: "langchain_openai" | "deterministic_fallback";
  model?: string;
  provider?: string;
  decision: AgentDecision;
  toolCalls: ToolCallLog[];
  trace: TraceEvent[];
  memory: AgentMemory;
  signals: Signal[];
  metrics: OutcomeMetrics;
};
