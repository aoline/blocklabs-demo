import chalk from "chalk";
import type {
  AgentDecision,
  AgentRunResult,
  PlayerCase,
  Signal,
  ToolCallLog,
  TraceEvent,
} from "../lib/types";
import type { AgentSignalConsumer } from "../lib/signalConsumers";
import type { CliRunRecord } from "./state";
import { getSignalTone, type SignalTone } from "../lib/signalDisplay";

const signalToneColor = {
  good: chalk.green,
  info: chalk.cyan,
  warning: chalk.yellow,
  danger: chalk.hex("#fb923c"),
  critical: chalk.redBright,
} satisfies Record<SignalTone, (text: string) => string>;

const statusColor = {
  bonus_granted: chalk.green,
  denied: chalk.yellow,
  human_escalation: chalk.hex("#c2410c"),
  kyc_required: chalk.hex("#c2410c"),
  responsible_gaming_review: chalk.hex("#c2410c"),
} satisfies Record<AgentDecision["status"], (text: string) => string>;

const mutedColor = chalk.hex("#aab7c6");

export function headline(text: string) {
  console.log(chalk.bold.white(`\n${text}`));
}

export function stage(index: number, title: string) {
  console.log(chalk.bold.blue(`\n${String(index).padStart(2, "0")} ${title}`));
}

export function muted(text: string) {
  return mutedColor(text);
}

export function success(text: string) {
  return chalk.green(text);
}

export function warning(text: string) {
  return chalk.yellow(text);
}

export function failure(text: string) {
  return chalk.red(text);
}

export function formatMoney(amount: number) {
  return `EUR ${amount.toLocaleString()}`;
}

export function printCaseSummary(playerCase: PlayerCase, scenario?: string) {
  console.log(`${chalk.bold("Player")} ${playerCase.playerId}`);
  if (scenario) console.log(`${chalk.bold("Scenario")} ${scenario}`);
}

export function printCase(playerCase: PlayerCase) {
  printCaseSummary(playerCase);
  console.log(`${chalk.bold("Missing bonus")} ${playerCase.campaign.campaignName} (${playerCase.campaign.playerEnteredBonusCode ?? "no code"})`);
  console.log(`${chalk.bold("Deposit")} ${formatMoney(playerCase.payments.depositAmount)} on ${new Date(playerCase.payments.depositTimestamp).toISOString()}`);
  console.log("");
  printSourceSystems(playerCase);
}

export function printSourceSystems(playerCase: PlayerCase) {
  console.log(chalk.bold("Source systems"));
  printSource(1, "CRM", [
    ["Player segment", playerCase.crm.playerSegment],
    ["VIP tier", playerCase.crm.vipTier],
    ["Lifetime deposits", formatMoney(playerCase.crm.lifetimeDeposits)],
    ["Last 30d deposits", formatMoney(playerCase.crm.last30DayDeposits)],
    ["Support tickets 30d", String(playerCase.crm.supportTickets30d)],
  ]);
  printSource(2, "KYC", [
    ["Status", playerCase.kyc.kycStatus],
    ["Age claimed", playerCase.kyc.ageClaimed === null ? "missing" : String(playerCase.kyc.ageClaimed)],
    ["ID verified", yesNo(playerCase.kyc.idVerified)],
    ["KYC country", playerCase.kyc.country],
  ]);
  printSource(3, "Campaign", [
    ["Operator", playerCase.operator.operatorName],
    ["Campaign ID", playerCase.campaign.campaignId],
    ["Campaign name", playerCase.campaign.campaignName],
    ["Expected bonus code", playerCase.campaign.bonusCode],
    ["Entered bonus code", playerCase.campaign.playerEnteredBonusCode ?? "missing"],
    ["Policy minimum deposit", formatMoney(playerCase.operator.policy.minimumDeposit)],
  ]);
  printSource(4, "Payments", [
    ["Deposit amount", `${playerCase.payments.depositCurrency} ${playerCase.payments.depositAmount.toLocaleString()}`],
    ["Deposit timestamp", playerCase.payments.depositTimestamp],
    ["Recent winnings", formatMoney(playerCase.payments.recentWinnings30d)],
    ["Chargebacks", String(playerCase.payments.chargebacks)],
    ["Failed deposits 30d", String(playerCase.payments.failedDeposits30d)],
  ]);
  printSource(5, "Bonus Ledger", [
    ["Prior claim status", playerCase.bonusLedger.priorClaimStatus],
    ["Credited at", playerCase.bonusLedger.creditedAt ?? "not credited"],
    ["Wagering status", playerCase.bonusLedger.wageringStatus],
    ["Wagering progress", `${playerCase.bonusLedger.wageringProgressPercent}%`],
    ["Previous bonus claims 30d", String(playerCase.bonusLedger.previousBonusClaims30d)],
  ]);
  printSource(6, "Fraud / Risk", [
    ["VPN detected", yesNo(playerCase.risk.vpnDetected)],
    ["VPN exit country", playerCase.risk.vpnExitCountry ?? "None"],
    ["Observed IP country", playerCase.risk.ipCountry],
    ["Device changed", yesNo(playerCase.risk.deviceChanged)],
    ["Country mismatch", countryMismatchLabel(playerCase)],
    ["Duplicate account suspected", yesNo(playerCase.risk.duplicateAccountSuspected)],
  ]);
  printSource(7, "Player Safety", [
    ["Deposit velocity", playerCase.responsibleGaming.depositVelocity],
    ["Night sessions 7d", String(playerCase.responsibleGaming.nightSessions7d)],
    ["Loss increase 30d", yesNo(playerCase.responsibleGaming.lossIncrease30d)],
    ["Self-exclusion history", yesNo(playerCase.responsibleGaming.selfExclusionHistory)],
  ]);
}

export function printSignals(signals: Signal[]) {
  signals.forEach((signal, index) => {
    const paint = signalToneColor[getSignalTone(signal)];
    if (index > 0) console.log("");
    console.log(`${index + 1}. ${chalk.bold(signal.name)} ${paint(signal.severity.toUpperCase())} (${signal.score})`);
    console.log(`   ${chalk.bold("Factors:")}`);
    printSignalFactors(signal, "     ");
    console.log(`   ${chalk.bold("Reason:")}`);
    signal.explanation.forEach((item) => console.log(`     ${item}`));
  });
}

export function printAgentConsumers(consumers: AgentSignalConsumer[]) {
  console.log(chalk.bold("LangChain AI Agent consumers"));
  for (const consumer of consumers) {
    const signals = consumer.signals.length
      ? consumer.signals.join(", ")
      : muted("no governed signal");
    console.log(`- ${chalk.bold(consumer.agent)}: ${signals}`);
  }
}

export function printCatalog(signals: Signal[]) {
  for (const signal of signals) {
    const paint = signalToneColor[getSignalTone(signal)];
    console.log(`${chalk.bold(signal.name)} ${paint(signal.severity.toUpperCase())}`);
    console.log("  factors");
    signal.factors.forEach((item) => {
      console.log(`    ${formatFactor(item)}`);
    });
    console.log(`  score       ${signal.score}`);
    console.log(`  owner       ${signal.owner}`);
    console.log(`  version     ${signal.version}`);
    console.log(`  sources     ${signal.sources.join(", ")}`);
    console.log(`  used by     ${signal.usedBy.join(", ")}`);
  }
}

export function printSignalExplanation(signal: Signal) {
  const paint = signalToneColor[getSignalTone(signal)];
  console.log(`${chalk.bold(signal.name)} ${paint(signal.severity.toUpperCase())}`);
  console.log("");
  console.log(chalk.bold("Factors"));
  printSignalFactors(signal);
  console.log("");
  console.log(`Score:      ${signal.score}`);
  console.log("");
  console.log(chalk.bold("Reason"));
  for (const item of signal.explanation) {
    console.log(`- ${item}`);
  }
  console.log("");
  console.log(`Owner:      ${signal.owner}`);
  console.log(`Version:    ${signal.version}`);
  console.log(`Confidence: ${Math.round(signal.confidence * 100)}%`);
  console.log(`Sources:    ${signal.sources.join(", ")}`);
  console.log(`Used by:    ${signal.usedBy.join(", ")}`);
  console.log(`Definition: ${signal.definition}`);
}

export function printDecision(result: AgentRunResult) {
  const paint = statusColor[result.decision.status];
  console.log(chalk.bold("AGENT DECISION"));
  console.log("");
  console.log(chalk.bold("Decision:"));
  console.log(paint(result.decision.status.replaceAll("_", " ")));
  console.log("");
  console.log(chalk.bold("Reason:"));
  console.log(result.decision.primaryReason);
  console.log("");
  printList("Actions taken", result.decision.actionsTaken);
  printList("Blocked actions", result.decision.blockedActions);
  console.log("");
  printOutcomeMetrics(result);
}

export function printOutcomeMetrics(result: AgentRunResult) {
  console.log(chalk.bold("OUTCOME METRICS"));
  console.log(`Deflected:          ${result.metrics.deflected ? success("Yes") : warning("No")}`);
  console.log(`Reopened:           ${result.metrics.reopened ? warning("Yes") : success("No")}`);
  console.log(`Time to resolve:    ${result.metrics.timeToResolveMs}ms`);
  console.log(`Signal outcome:     ${result.metrics.signalOutcomeCode}`);
  console.log(`Human escalated:    ${yesNo(result.metrics.humanEscalated)}`);
  console.log(`Bonus granted:      ${yesNo(result.metrics.bonusGranted)}`);
  console.log(`Player message:     ${yesNo(result.metrics.playerMessageSent)}`);
}

export function printToolCalls(
  toolCalls: ToolCallLog[],
  options: { showJsonDetails?: boolean } = {},
) {
  console.log(chalk.bold("TOOLS EXECUTED"));
  console.log("");
  if (toolCalls.length === 0) {
    console.log(muted("No tool calls recorded."));
    return;
  }
  for (const call of toolCalls) {
    const mark = call.status === "success" ? success("✓") : failure("✗");
    console.log(`${mark} ${chalk.bold(`${call.toolName}()`)}`);
    if (!options.showJsonDetails) continue;

    console.log("");
    console.log(chalk.bold("Arguments:"));
    console.log(JSON.stringify(call.arguments, null, 2));
    console.log("");
    console.log(chalk.bold("Result:"));
    console.log(JSON.stringify(call.result, null, 2));
    console.log("");
  }
}

export function printTrace(trace: TraceEvent[]) {
  for (const event of trace) {
    const time = new Date(event.timestamp).toLocaleTimeString();
    console.log(`${muted(time)} ${chalk.bold(event.title)}`);
    console.log(`         ${event.detail}`);
  }
}

export function printRunRecord(record: CliRunRecord) {
  console.log(`${chalk.bold("Run")}    ${record.runId}`);
  console.log(`${chalk.bold("Mode")}   ${record.mode}`);
  console.log(`${chalk.bold("Status")} ${record.status === "completed" ? success(record.status) : failure(record.status)}`);

  if (record.result) {
    console.log("");
    printDecision(record.result);
    return;
  }

  if (record.error) {
    console.log("");
    console.log(failure(record.error.title));
    if (record.error.provider) console.log(`Provider: ${record.error.provider}`);
    if (record.error.model) console.log(`Model:    ${record.error.model}`);
    console.log(record.error.detail);
  }
}

function printList(label: string, values: string[]) {
  console.log(chalk.bold(label));
  if (values.length === 0) {
    console.log(`- ${muted("none")}`);
    return;
  }
  values.forEach((item) => console.log(`- ${item}`));
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function countryMismatchLabel(playerCase: PlayerCase) {
  const status = yesNo(playerCase.risk.countryMismatch);
  if (!playerCase.risk.countryMismatch) return status;

  return `${status} (KYC ${playerCase.kyc.country} vs IP ${playerCase.risk.ipCountry})`;
}

function printSource(index: number, name: string, rows: Array<[string, string]>) {
  console.log(chalk.bold(`${String(index).padStart(2, "0")}. Source: ${name}`));
  for (const [label, value] of rows) {
    console.log(`    ${label.padEnd(30)} ${value}`);
  }
}

function printSignalFactors(signal: Signal, indent = "") {
  for (const item of signal.factors) {
    console.log(`${indent}✓ ${formatFactor(item)}`);
  }
}

function formatFactor(factor: Signal["factors"][number]) {
  if (factor.score === undefined) return factor.name;
  const sign = factor.score >= 0 ? "+" : "";
  return `${factor.name} (${sign}${factor.score})`;
}
