import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRunResult, OutcomeMetrics, PlayerCase, Signal } from "../lib/types";

export type CliRunMode = "live" | "offline";

export type CliRunRecord = {
  runId: string;
  createdAt: string;
  mode: CliRunMode;
  status: "completed" | "failed";
  playerCase: PlayerCase;
  signals: Signal[];
  result?: AgentRunResult;
  error?: {
    title: string;
    detail: string;
    provider?: string;
    model?: string;
  };
};

const stateDir = path.join(process.cwd(), ".signalops");
const runsDir = path.join(stateDir, "runs");
const memoryDir = path.join(stateDir, "memory");
const currentCasePath = path.join(stateDir, "current-case.json");
const currentSignalsPath = path.join(stateDir, "current-signals.json");
const currentRunPath = path.join(stateDir, "current-run.json");

async function ensureStateDirs() {
  await mkdir(runsDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function makeRunId(playerId: string) {
  const compactDate = new Date()
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${playerId}-${compactDate}-${suffix}`;
}

export async function saveCurrentCase(playerCase: PlayerCase) {
  await ensureStateDirs();
  await writeJson(currentCasePath, playerCase);
}

export async function readCurrentCase() {
  if (!existsSync(currentCasePath)) {
    throw new Error("No current player type. Run `signalops generate <preset>` first.");
  }
  return readJson<PlayerCase>(currentCasePath);
}

export async function saveCurrentSignals(signals: Signal[]) {
  await ensureStateDirs();
  await writeJson(currentSignalsPath, signals);
}

export async function readCurrentSignals() {
  if (!existsSync(currentSignalsPath)) return null;
  return readJson<Signal[]>(currentSignalsPath);
}

export async function saveMemory(result: AgentRunResult) {
  await ensureStateDirs();
  await writeJson(path.join(memoryDir, `bonus-${result.memory.playerId}.json`), result.memory);
}

export async function readMemory(playerId: string) {
  const memoryPath = path.join(memoryDir, `bonus-${playerId}.json`);
  if (!existsSync(memoryPath)) return null;
  return readJson<AgentRunResult["memory"]>(memoryPath);
}

export async function saveRunRecord(record: CliRunRecord) {
  await ensureStateDirs();
  await writeJson(path.join(runsDir, `${record.runId}.json`), record);
  await writeJson(currentRunPath, { runId: record.runId });
}

export async function readRunRecord(runId?: string) {
  let resolvedRunId = runId;

  if (!resolvedRunId || resolvedRunId === "current") {
    if (!existsSync(currentRunPath)) {
      throw new Error("No current run. Run `signalops run` first.");
    }
    resolvedRunId = (await readJson<{ runId: string }>(currentRunPath)).runId;
  }

  const runPath = path.join(runsDir, `${resolvedRunId}.json`);
  if (!existsSync(runPath)) {
    throw new Error(`Run not found: ${resolvedRunId}`);
  }
  return readJson<CliRunRecord>(runPath);
}

export async function listRunRecords() {
  await ensureStateDirs();
  const files = await readdir(runsDir);
  const records = await Promise.all(
    files
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => readJson<CliRunRecord>(path.join(runsDir, fileName))),
  );

  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function aggregateMetrics(records: CliRunRecord[]) {
  const completed = records.filter((record) => record.status === "completed" && record.result?.metrics);
  const metrics = completed.map((record) => record.result?.metrics).filter(Boolean) as OutcomeMetrics[];
  const automatedResolved = metrics.filter((metric) => metric.deflected);
  const reopenedAutomated = automatedResolved.filter((metric) => metric.reopened);
  const byOutcome = new Map<string, number>();
  const byOperator = new Map<string, number>();
  const byCampaign = new Map<string, number>();

  completed.forEach((record) => {
    const outcome = record.result?.metrics.signalOutcomeCode ?? "unknown";
    byOutcome.set(outcome, (byOutcome.get(outcome) ?? 0) + 1);
    byOperator.set(record.playerCase.operator.operatorId, (byOperator.get(record.playerCase.operator.operatorId) ?? 0) + 1);
    byCampaign.set(record.playerCase.campaign.campaignId, (byCampaign.get(record.playerCase.campaign.campaignId) ?? 0) + 1);
  });

  return {
    totalComplaints: completed.length,
    deflected: automatedResolved.length,
    humanEscalated: metrics.filter((metric) => metric.humanEscalated).length,
    reopened: reopenedAutomated.length,
    deflectionRate: completed.length ? automatedResolved.length / completed.length : 0,
    reopenRate: automatedResolved.length ? reopenedAutomated.length / automatedResolved.length : 0,
    byOutcome: Object.fromEntries(byOutcome),
    byOperator: Object.fromEntries(byOperator),
    byCampaign: Object.fromEntries(byCampaign),
  };
}

export async function loadCaseFromFile(filePath: string) {
  return readJson<PlayerCase>(path.resolve(filePath));
}

export async function writeCaseToFile(filePath: string, playerCase: PlayerCase) {
  await writeJson(path.resolve(filePath), playerCase);
}

export function stateSummary() {
  return {
    stateDir,
    runsDir,
    memoryDir,
  };
}
