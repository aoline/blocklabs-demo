import { AIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import { z } from "zod";
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
} from "./decisionReason";

type LangChainContext = {
  playerCase: PlayerCase;
  signals: Signal[];
  memory: AgentMemory | null;
  toolCalls: ToolCallLog[];
  trace: TraceEvent[];
};

type ActionToolName =
  | "grantBonus"
  | "sendPlayerMessage"
  | "showActivePromotions"
  | "createHumanEscalation"
  | "createSupportResolutionNote"
  | "pausePromotions";

type ToolName = "getBonusEligibilitySignal" | ActionToolName;

const playerIdSchema = z.object({
  playerId: z.string().describe("Player ID for the missing-bonus complaint."),
});

const reasonSchema = z.object({
  playerId: z.string().describe("Player ID for the missing-bonus complaint."),
  reason: z.string().optional().describe("Optional model note. The server records the governed reason."),
});

function now(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function addTrace(
  context: LangChainContext,
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

function logToolCall(
  context: LangChainContext,
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  const call: ToolCallLog = {
    id: makeId("TOOL"),
    timestamp: now(),
    toolName,
    arguments: args,
    result,
    status: result.success === false ? "failure" : "success",
  };

  context.toolCalls.push(call);
  addTrace(
    context,
    "tool_called",
    `LangChain tool called: ${toolName}`,
    JSON.stringify(args),
    result,
  );

  if (toolName !== "getBonusEligibilitySignal") {
    addTrace(
      context,
      "action_completed",
      `Action completed: ${toolName}`,
      String(result.reason ?? result.action ?? result.error ?? "Completed"),
      result,
    );
  }

  return result;
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

function createBonusTools(context: LangChainContext) {
  return [
    tool(
      ({ playerId }) =>
        logToolCall(context, "getBonusEligibilitySignal", { playerId }, {
          success: true,
          signal: publicBonusSignal(context.signals),
        }),
      {
        name: "getBonusEligibilitySignal",
        description: "Fetch the deterministic governed Bonus Eligibility Signal for this missing-bonus complaint.",
        schema: playerIdSchema,
      },
    ),
    tool(
      ({ playerId, campaignId }) => {
        const outcomeCode = bonusOutcomeCode(context.signals);
        const allowed = outcomeCode === "BONUS_CREDIT_VERIFIED";
        return logToolCall(context, "grantBonus", { playerId, campaignId }, {
          success: allowed,
          action: "grantBonus",
          bonusGrantId: allowed ? makeId("BONUS") : null,
          campaignId,
          reason: allowed
            ? "Bonus Eligibility Signal verified automated crediting."
            : "Server guardrail blocked bonus grant because the Bonus Eligibility Signal is not verified.",
          timestamp: now(),
        });
      },
      {
        name: "grantBonus",
        description: "Grant the campaign bonus only when Bonus Eligibility Signal outcome is BONUS_CREDIT_VERIFIED.",
        schema: z.object({
          playerId: z.string(),
          campaignId: z.string(),
        }),
      },
    ),
    tool(
      ({ playerId, message }) =>
        logToolCall(context, "sendPlayerMessage", { playerId, message }, {
          success: true,
          action: "sendPlayerMessage",
          messageId: makeId("MSG"),
          playerId,
          message,
          timestamp: now(),
        }),
      {
        name: "sendPlayerMessage",
        description: "Send a concise support message to the player after interpreting the governed outcome.",
        schema: z.object({
          playerId: z.string(),
          message: z.string(),
        }),
      },
    ),
    tool(
      ({ playerId }) =>
        logToolCall(context, "showActivePromotions", { playerId }, {
          success: true,
          action: "showActivePromotions",
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
        }),
      {
        name: "showActivePromotions",
        description: "Show active promotions after a governed denial where a safer alternative offer is useful.",
        schema: playerIdSchema,
      },
    ),
    tool(
      ({ playerId }) => {
        const reason = buildHumanDecisionReason(
          statusFromOutcome(bonusOutcomeCode(context.signals)),
          context.playerCase,
          context.signals,
        );
        return logToolCall(context, "createHumanEscalation", { playerId, reason }, {
          success: true,
          action: "createHumanEscalation",
          escalationId: makeId("ESC"),
          queue: bonusOutcomeCode(context.signals) === "BONUS_CREDIT_BLOCKED_RG"
            ? "Player Safety"
            : "Support Bonus Review",
          reason,
          timestamp: now(),
        });
      },
      {
        name: "createHumanEscalation",
        description: "Escalate unresolved, blocked, or uncertain bonus complaints to a human support queue.",
        schema: reasonSchema,
      },
    ),
    tool(
      ({ playerId }) => {
        const reason = buildHumanDecisionReason(
          statusFromOutcome(bonusOutcomeCode(context.signals)),
          context.playerCase,
          context.signals,
        );
        return logToolCall(context, "createSupportResolutionNote", { playerId, reason }, {
          success: true,
          action: "createSupportResolutionNote",
          noteId: makeId("NOTE"),
          complaintId: context.playerCase.support.complaintId,
          outcomeCode: bonusOutcomeCode(context.signals),
          reason,
          timestamp: now(),
        });
      },
      {
        name: "createSupportResolutionNote",
        description: "Persist the governed outcome, selected action, and support-facing resolution summary.",
        schema: reasonSchema,
      },
    ),
    tool(
      ({ playerId }) => {
        const reason = buildHumanDecisionReason(
          "responsible_gaming_review",
          context.playerCase,
          context.signals,
        );
        return logToolCall(context, "pausePromotions", { playerId, reason }, {
          success: true,
          action: "pausePromotions",
          promotionState: "paused",
          reason,
          timestamp: now(),
        });
      },
      {
        name: "pausePromotions",
        description: "Pause promotions when the governed signal is blocked by responsible-gaming controls.",
        schema: reasonSchema,
      },
    ),
  ];
}

function statusFromOutcome(outcomeCode: BonusEligibilityOutcomeCode): AgentDecision["status"] {
  if (outcomeCode === "BONUS_CREDIT_VERIFIED") return "bonus_granted";
  if (outcomeCode === "BONUS_CREDIT_BLOCKED_RG") return "responsible_gaming_review";
  if (outcomeCode === "BONUS_CREDIT_BLOCKED_RISK" || outcomeCode === "BONUS_CREDIT_UNCERTAIN") {
    return "human_escalation";
  }
  return "denied";
}

function langChainSystemPrompt() {
  return [
    "You are the Bonus Resolution Agent for a white-label iGaming platform.",
    "",
    "You do not calculate eligibility from raw data. You consume the governed Bonus Eligibility Signal produced by the Signal Layer.",
    "Never generate, modify, or infer signal names, scores, severity, explanations, ownership, versions, consumers, formulas, factors, or outcome codes.",
    "If the signal is missing, call getBonusEligibilitySignal. Do not invent a replacement signal.",
    "",
    "Your job is to choose allowed tools based on the supplied signal outcome, operator policy, guardrails, and memory.",
    "You must act through tools. Do not just return text.",
    "",
    "Required tool use:",
    "- Call getBonusEligibilitySignal before deciding.",
    "- If outcome is BONUS_CREDIT_VERIFIED: call grantBonus, sendPlayerMessage, and createSupportResolutionNote.",
    "- If outcome is a deterministic denial: call sendPlayerMessage, showActivePromotions, and createSupportResolutionNote.",
    "- If outcome is BONUS_CREDIT_BLOCKED_RG: call pausePromotions, createHumanEscalation, sendPlayerMessage, and createSupportResolutionNote.",
    "- If outcome is BONUS_CREDIT_BLOCKED_RISK or BONUS_CREDIT_UNCERTAIN: call createHumanEscalation, sendPlayerMessage, and createSupportResolutionNote.",
    "",
    "Guardrails:",
    "- Underage risk, KYC risk, fraud risk, and responsible-gaming risk always override Player Value.",
    "- Player Value may affect tone and service priority but must never override risk, KYC, or player-safety controls.",
    "- Never call grantBonus unless Bonus Eligibility Signal outcome is BONUS_CREDIT_VERIFIED.",
    "- The server will reject grantBonus when the governed signal is not verified.",
    "",
    "After tool calls are complete, return a concise final decision summary for a product or engineering leader.",
  ].join("\n");
}

function lastAiMessageContent(messages: unknown[]): string {
  const lastAi = [...messages]
    .reverse()
    .find((message) => AIMessage.isInstance(message)) as AIMessage | undefined;

  if (!lastAi) return "LangChain agent completed the bonus resolution review.";
  if (typeof lastAi.content === "string") return lastAi.content;
  return JSON.stringify(lastAi.content);
}

function signalNames(signals: Signal[]) {
  return signals.map((signal) => signal.name);
}

function actionWasCalled(toolCalls: ToolCallLog[], toolName: ToolName) {
  return toolCalls.some((call) => call.toolName === toolName && call.status === "success");
}

function deriveDecision(
  playerCase: PlayerCase,
  signals: Signal[],
  toolCalls: ToolCallLog[],
  finalSummary: string,
): AgentDecision {
  const outcomeCode = bonusOutcomeCode(signals);
  const status = statusFromOutcome(outcomeCode);
  const actionsTaken: string[] = [];
  const blockedActions = new Set<string>();

  if (actionWasCalled(toolCalls, "grantBonus")) actionsTaken.push("Granted bonus");
  if (actionWasCalled(toolCalls, "sendPlayerMessage")) actionsTaken.push("Sent player message");
  if (actionWasCalled(toolCalls, "showActivePromotions")) actionsTaken.push("Displayed active promotions");
  if (actionWasCalled(toolCalls, "pausePromotions")) actionsTaken.push("Paused promotions");
  if (actionWasCalled(toolCalls, "createHumanEscalation")) actionsTaken.push("Created human escalation");
  if (actionWasCalled(toolCalls, "createSupportResolutionNote")) actionsTaken.push("Created support resolution note");

  if (outcomeCode !== "BONUS_CREDIT_VERIFIED") blockedActions.add("grantBonus");
  if (outcomeCode === "BONUS_CREDIT_BLOCKED_RG") blockedActions.add("sendPromotionOffer");
  if (playerCase.crm.vipTier !== "None" && outcomeCode !== "BONUS_CREDIT_VERIFIED") {
    blockedActions.add("player-value override");
  }

  return {
    status,
    summary: finalSummary,
    primaryReason: buildHumanDecisionReason(status, playerCase, signals),
    actionsTaken,
    blockedActions: Array.from(blockedActions),
    signalsUsed: signalNames(signals),
    toolCalls,
  };
}

function buildMetrics(
  playerCase: PlayerCase,
  outcomeCode: BonusEligibilityOutcomeCode,
  decision: AgentDecision,
  toolCalls: ToolCallLog[],
  startedAt: number,
): OutcomeMetrics {
  const humanEscalated = actionWasCalled(toolCalls, "createHumanEscalation");
  const bonusGranted = actionWasCalled(toolCalls, "grantBonus");
  const playerMessageSent = actionWasCalled(toolCalls, "sendPlayerMessage");

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

export async function runLangChainBonusResolutionAgent(input: {
  case: PlayerCase;
  signals?: Signal[];
  memory?: AgentMemory | null;
}): Promise<AgentRunResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const startedAt = Date.now();
  const signals = input.signals?.length
    ? ensureDecisionSignals(input.case, input.signals)
    : calculateSignals(input.case);
  const context: LangChainContext = {
    playerCase: input.case,
    signals,
    memory: input.memory ?? null,
    toolCalls: [],
    trace: [],
  };
  const modelName = process.env.OPENAI_MODEL || "gpt-5.5";
  const outcomeCode = bonusOutcomeCode(signals);

  addTrace(
    context,
    "case_generated",
    "Missing bonus complaint received",
    `${input.case.playerId} reported that ${input.case.campaign.campaignName} was not credited.`,
    input.case,
  );

  signals.forEach((signal) => {
    addTrace(
      context,
      "signal_calculated",
      `Signal calculated: ${signal.name}`,
      `${signal.severity.toUpperCase()} score ${signal.score}`,
      signal,
    );
  });

  addTrace(
    context,
    "agent_started",
    "LangChain agent started",
    `Using ChatOpenAI model ${modelName} with 7 registered tools.`,
    { modelName, toolCount: 7 },
  );

  const agent = createAgent({
    model: new ChatOpenAI({
      model: modelName,
      maxRetries: 1,
    }),
    tools: createBonusTools(context),
    systemPrompt: langChainSystemPrompt(),
  });

  const result = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content: [
            "Resolve this missing-bonus complaint.",
            "",
            `Player ID: ${input.case.playerId}`,
            `Complaint ID: ${input.case.support.complaintId}`,
            `Campaign: ${input.case.campaign.campaignId}`,
            `Bonus code: ${input.case.campaign.playerEnteredBonusCode ?? "missing"}`,
            "",
            "Governed Bonus Eligibility Signal:",
            JSON.stringify(getSignal(signals, "Bonus Eligibility Signal"), null, 2),
            "",
            "Player-facing message guidance:",
            buildPlayerMessage(outcomeCode, input.case),
            "",
            "Memory:",
            JSON.stringify(input.memory ?? null, null, 2),
            "",
            "Return the final summary only after completing tool calls.",
          ].join("\n"),
        },
      ],
    },
    {
      configurable: {
        thread_id: `bonus-resolution-${input.case.playerId}`,
      },
      recursionLimit: 20,
    },
  );

  const finalSummary = lastAiMessageContent(result.messages);
  const decision = deriveDecision(input.case, signals, context.toolCalls, finalSummary);
  const metrics = buildMetrics(input.case, outcomeCode, decision, context.toolCalls, startedAt);

  addTrace(
    context,
    "decision_made",
    `Decision: ${decision.status.replaceAll("_", " ")}`,
    decision.primaryReason,
    decision,
  );
  addTrace(
    context,
    "metrics_recorded",
    "Outcome metrics recorded",
    `Deflected: ${metrics.deflected}; reopened: ${metrics.reopened}; time: ${metrics.timeToResolveMs}ms.`,
    metrics,
  );
  addTrace(
    context,
    "agent_finished",
    "LangChain agent finished",
    `LangChain returned ${result.messages.length} messages including tool-call messages.`,
    { messageCount: result.messages.length },
  );

  const memory: AgentMemory = {
    playerId: input.case.playerId,
    previousDecisions: [
      ...(input.memory?.previousDecisions ?? []),
      decision.status,
    ],
    previousActions: [
      ...(input.memory?.previousActions ?? []),
      ...decision.actionsTaken,
    ],
    notes: [
      ...(input.memory?.notes ?? []),
      decision.primaryReason,
    ],
  };

  return {
    executionMode: "langchain_openai",
    provider: "openai",
    model: modelName,
    decision,
    toolCalls: context.toolCalls,
    trace: context.trace,
    memory,
    signals,
    metrics,
  };
}
