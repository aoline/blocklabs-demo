import {
  calculateSignals,
  ensureDecisionSignals,
  getSignal,
} from "./signals";
import type {
  AgentDecision,
  AgentMemory,
  AgentRunResult,
  BonusEligibilityOutcomeCode,
  OutcomeMetrics,
  PlayerCase,
  Signal,
  ToolCallLog,
  TraceEvent,
} from "./types";
import {
  bonusOutcomeCode,
  buildHumanDecisionReason,
  buildPlayerMessage,
  isAutomatableDenial,
} from "./decisionReason";

type AgentContext = {
  playerCase: PlayerCase;
  signals: Signal[];
  memory: AgentMemory | null;
  toolCalls: ToolCallLog[];
  trace: TraceEvent[];
};

type ToolName =
  | "getBonusEligibilitySignal"
  | "grantBonus"
  | "sendPlayerMessage"
  | "showActivePromotions"
  | "createHumanEscalation"
  | "createSupportResolutionNote"
  | "pausePromotions";

function now(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function trace(
  context: AgentContext,
  type: TraceEvent["type"],
  title: string,
  detail: string,
  data?: unknown,
) {
  context.trace.push({
    id: makeId("TRACE"),
    timestamp: now(),
    type,
    title,
    detail,
    data,
  });
}

function publicBonusSignal(signals: Signal[]) {
  const signal = getSignal(signals, "Bonus Eligibility Signal");
  return {
    name: signal.name,
    severity: signal.severity,
    score: signal.score,
    outcomeCode: signal.outcomeCode,
    owner: signal.owner,
    version: signal.version,
    consumers: signal.usedBy,
    explanation: signal.explanation,
    factors: signal.factors,
  };
}

function runTool(
  context: AgentContext,
  toolName: ToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const { playerCase, signals } = context;
  const outcomeCode = bonusOutcomeCode(signals);
  let result: Record<string, unknown>;

  switch (toolName) {
    case "getBonusEligibilitySignal":
      result = { success: true, signal: publicBonusSignal(signals) };
      break;
    case "grantBonus": {
      const allowed = outcomeCode === "BONUS_CREDIT_VERIFIED";
      result = {
        success: allowed,
        action: toolName,
        bonusGrantId: allowed ? makeId("BONUS") : null,
        playerId: playerCase.playerId,
        campaignId: playerCase.campaign.campaignId,
        reason: allowed
          ? "Bonus Eligibility Signal verified automated crediting."
          : "Server guardrail blocked bonus grant because the Bonus Eligibility Signal is not verified.",
        timestamp: now(),
      };
      break;
    }
    case "sendPlayerMessage":
      result = {
        success: true,
        action: toolName,
        messageId: makeId("MSG"),
        playerId: playerCase.playerId,
        message: args.message,
        timestamp: now(),
      };
      break;
    case "showActivePromotions":
      result = {
        success: true,
        action: toolName,
        playerId: playerCase.playerId,
        promotions: [
          {
            campaignId: "CMP-WC26-KNOCKOUT-BOOST",
            name: "World Cup 2026 Knockout Boost",
            bonusCode: "KNOCKOUT26",
          },
          {
            campaignId: "CMP-WC26-VIP-CASHBACK",
            name: "World Cup 2026 VIP Cashback",
            bonusCode: "VIPWC26",
          },
        ],
        timestamp: now(),
      };
      break;
    case "createHumanEscalation":
      result = {
        success: true,
        action: toolName,
        escalationId: makeId("ESC"),
        queue: outcomeCode === "BONUS_CREDIT_BLOCKED_RG" ? "Player Safety" : "Support Bonus Review",
        reason: args.reason,
        timestamp: now(),
      };
      break;
    case "createSupportResolutionNote":
      result = {
        success: true,
        action: toolName,
        noteId: makeId("NOTE"),
        complaintId: playerCase.support.complaintId,
        outcomeCode,
        reason: args.reason,
        timestamp: now(),
      };
      break;
    case "pausePromotions":
      result = {
        success: true,
        action: toolName,
        promotionState: "paused",
        playerId: playerCase.playerId,
        reason: args.reason,
        timestamp: now(),
      };
      break;
  }

  const toolCall: ToolCallLog = {
    id: makeId("TOOL"),
    timestamp: now(),
    toolName,
    arguments: args,
    result,
    status: result.success === false ? "failure" : "success",
  };
  context.toolCalls.push(toolCall);
  trace(context, "tool_called", `Tool called: ${toolName}`, JSON.stringify(args), result);

  if (toolName !== "getBonusEligibilitySignal") {
    trace(
      context,
      "action_completed",
      `Action completed: ${toolName}`,
      String(result.reason ?? result.action),
      result,
    );
  }

  return result;
}

function statusFromOutcome(outcomeCode: BonusEligibilityOutcomeCode): AgentDecision["status"] {
  if (outcomeCode === "BONUS_CREDIT_VERIFIED") return "bonus_granted";
  if (outcomeCode === "BONUS_CREDIT_BLOCKED_RG") return "responsible_gaming_review";
  if (outcomeCode === "BONUS_CREDIT_BLOCKED_RISK" || outcomeCode === "BONUS_CREDIT_UNCERTAIN") {
    return "human_escalation";
  }
  return "denied";
}

function hasSuccessfulTool(toolCalls: ToolCallLog[], toolName: ToolName): boolean {
  return toolCalls.some((call) => call.toolName === toolName && call.status === "success");
}

function buildMetrics(
  playerCase: PlayerCase,
  outcomeCode: BonusEligibilityOutcomeCode,
  decision: AgentDecision,
  toolCalls: ToolCallLog[],
  startedAt: number,
): OutcomeMetrics {
  const humanEscalated = hasSuccessfulTool(toolCalls, "createHumanEscalation");
  const bonusGranted = hasSuccessfulTool(toolCalls, "grantBonus");
  const playerMessageSent = hasSuccessfulTool(toolCalls, "sendPlayerMessage");

  return {
    deflected: !humanEscalated && playerMessageSent,
    reopened: playerCase.support.reopenedWithinWindow,
    timeToResolveMs: Math.max(1, Date.now() - startedAt),
    resolutionOutcome: decision.status,
    signalOutcomeCode: outcomeCode,
    humanEscalated,
    bonusGranted,
    playerMessageSent,
  };
}

export function runBonusResolutionAgent(input: {
  case: PlayerCase;
  signals?: Signal[];
  memory?: AgentMemory | null;
}): AgentRunResult {
  const startedAt = Date.now();
  const signals = input.signals?.length
    ? ensureDecisionSignals(input.case, input.signals)
    : calculateSignals(input.case);
  const context: AgentContext = {
    playerCase: input.case,
    signals,
    memory: input.memory ?? null,
    toolCalls: [],
    trace: [],
  };
  const outcomeCode = bonusOutcomeCode(signals);
  const status = statusFromOutcome(outcomeCode);
  const actionsTaken: string[] = [];
  const blockedActions = new Set<string>();

  trace(
    context,
    "case_generated",
    "Missing bonus complaint received",
    `${input.case.playerId} reported that ${input.case.campaign.campaignName} was not credited.`,
    input.case,
  );

  signals.forEach((signal) => {
    trace(
      context,
      "signal_calculated",
      `Signal calculated: ${signal.name}`,
      `${signal.severity.toUpperCase()} score ${signal.score}`,
      signal,
    );
  });

  trace(
    context,
    "agent_started",
    "Bonus Resolution Agent started",
    "Agent received the governed Bonus Eligibility Signal and approved tool schemas.",
    input.memory,
  );

  runTool(context, "getBonusEligibilitySignal", { playerId: input.case.playerId });

  const decisionReason = buildHumanDecisionReason(status, input.case, signals);

  if (outcomeCode === "BONUS_CREDIT_VERIFIED") {
    runTool(context, "grantBonus", {
      playerId: input.case.playerId,
      campaignId: input.case.campaign.campaignId,
    });
    actionsTaken.push("Granted bonus");
    runTool(context, "sendPlayerMessage", {
      playerId: input.case.playerId,
      message: buildPlayerMessage(outcomeCode, input.case),
    });
    actionsTaken.push("Sent player message");
  } else if (isAutomatableDenial(outcomeCode)) {
    blockedActions.add("grantBonus");
    runTool(context, "sendPlayerMessage", {
      playerId: input.case.playerId,
      message: buildPlayerMessage(outcomeCode, input.case),
    });
    actionsTaken.push("Sent player message");
    runTool(context, "showActivePromotions", {
      playerId: input.case.playerId,
      reason: outcomeCode,
    });
    actionsTaken.push("Displayed active promotions");
  } else {
    blockedActions.add("grantBonus");
    if (outcomeCode === "BONUS_CREDIT_BLOCKED_RG") {
      trace(
        context,
        "guardrail_triggered",
        "Guardrail triggered: responsible gaming",
        "Player-safety controls block promotional resolution.",
        getSignal(signals, "Responsible Gaming Risk"),
      );
      runTool(context, "pausePromotions", {
        playerId: input.case.playerId,
        reason: decisionReason,
      });
      actionsTaken.push("Paused promotions");
    } else {
      trace(
        context,
        "guardrail_triggered",
        "Guardrail triggered: risk or uncertainty",
        "The signal outcome requires human review before crediting a bonus.",
        getSignal(signals, "Bonus Eligibility Signal"),
      );
    }
    runTool(context, "createHumanEscalation", {
      playerId: input.case.playerId,
      complaintId: input.case.support.complaintId,
      reason: decisionReason,
    });
    actionsTaken.push("Created human escalation");
    runTool(context, "sendPlayerMessage", {
      playerId: input.case.playerId,
      message: buildPlayerMessage(outcomeCode, input.case),
    });
    actionsTaken.push("Sent player message");
  }

  runTool(context, "createSupportResolutionNote", {
    playerId: input.case.playerId,
    complaintId: input.case.support.complaintId,
    reason: decisionReason,
  });
  actionsTaken.push("Created support resolution note");

  const decision: AgentDecision = {
    status,
    summary:
      status === "bonus_granted"
        ? "Missing bonus complaint resolved automatically."
        : status === "denied"
          ? "Missing bonus complaint resolved with a governed denial."
          : "Missing bonus complaint escalated with full context.",
    primaryReason: decisionReason,
    actionsTaken,
    blockedActions: Array.from(blockedActions),
    signalsUsed: signals.map((signal) => signal.name),
    toolCalls: context.toolCalls,
  };

  trace(
    context,
    "decision_made",
    `Decision: ${status.replaceAll("_", " ")}`,
    decision.primaryReason,
    decision,
  );

  const metrics = buildMetrics(input.case, outcomeCode, decision, context.toolCalls, startedAt);
  trace(
    context,
    "metrics_recorded",
    "Outcome metrics recorded",
    `Deflected: ${metrics.deflected}; reopened: ${metrics.reopened}; time: ${metrics.timeToResolveMs}ms.`,
    metrics,
  );
  trace(
    context,
    "agent_finished",
    "Agent finished",
    "Final decision, tool-call log, trace, and outcome metrics are ready for audit.",
    { status, outcomeCode },
  );

  const memory: AgentMemory = {
    playerId: input.case.playerId,
    previousDecisions: [
      ...(input.memory?.previousDecisions ?? []),
      status,
    ],
    previousActions: [
      ...(input.memory?.previousActions ?? []),
      ...actionsTaken,
    ],
    notes: [
      ...(input.memory?.notes ?? []),
      decision.primaryReason,
    ],
  };

  return {
    executionMode: "deterministic_fallback",
    provider: "local",
    decision,
    toolCalls: context.toolCalls,
    trace: context.trace,
    memory,
    signals,
    metrics,
  };
}
