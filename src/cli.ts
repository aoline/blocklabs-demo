#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import {
  clearScreenDown,
  cursorTo,
  emitKeypressEvents,
  moveCursor,
} from "node:readline";
import { createInterface, type Interface } from "node:readline/promises";
import path from "node:path";
import { Command } from "commander";
import ora from "ora";
import {
  BONUS_DEPOSIT_OPTIONS,
  generateRandomCase,
  getPresetCase,
  presetCases,
  type PresetKey,
  withBonusDepositAmount,
} from "./lib/cases";
import { runBonusResolutionAgent } from "./lib/agent";
import { runLangChainBonusResolutionAgent } from "./lib/langchainAgent";
import { getAgentSignalConsumers } from "./lib/signalConsumers";
import { calculateSignals, getSignal, getSourceSignals } from "./lib/signals";
import type { PlayerCase, Signal } from "./lib/types";
import {
  failure,
  formatMoney,
  headline,
  muted,
  printAgentConsumers,
  printCase,
  printCaseSummary,
  printCatalog,
  printDecision,
  printOutcomeMetrics,
  printRunRecord,
  printSignalExplanation,
  printSignals,
  printSourceSystems,
  printToolCalls,
  printTrace,
  stage,
  success,
  warning,
} from "./cli/format";
import {
  aggregateMetrics,
  listRunRecords,
  loadCaseFromFile,
  makeRunId,
  readCurrentCase,
  readCurrentSignals,
  readMemory,
  readRunRecord,
  saveCurrentCase,
  saveCurrentSignals,
  saveMemory,
  saveRunRecord,
  stateSummary,
  writeCaseToFile,
  type CliRunMode,
  type CliRunRecord,
} from "./cli/state";

type GenerateOptions = {
  out?: string;
  json?: boolean;
};

type SignalsOptions = {
  json?: boolean;
};

type RunOptions = {
  offline?: boolean;
  json?: boolean;
  model?: string;
};

type DemoOptions = RunOptions & {
  step?: boolean;
  deposit?: string;
  toolDetails?: boolean;
  pause?: () => Promise<void>;
  chooseDeposit?: (currentAmount: number) => Promise<number>;
  setExitCodeOnFailure?: boolean;
};

type TraceOptions = {
  json?: boolean;
  toolDetails?: boolean;
};

type ReplayOptions = {
  toolDetails?: boolean;
};

type StudioOptions = {
  live?: boolean;
  offline?: boolean;
  model?: string;
};

type OpenAIResponse = {
  ok: boolean;
  status: number;
  payload: unknown;
};

type OpenAIErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: string;
    param?: string | null;
  };
};

type MenuItem<T extends string> = {
  label: string;
  value: T;
  shortcut?: string;
};

const program = new Command();

const signalLayerExplainer =
  "Signals are usually business concepts originating from regulatory, operational, financial, compliance, or risk requirements.";

loadLocalEnv();

program
  .name("signalops")
  .description("BlockLabs CLI proof layer for governed bonus eligibility agents.")
  .version("0.1.0");

program
  .command("generate")
  .argument("<playerType>", "eligible | expired | claimed | mismatch | wagering | blocked | random")
  .option("--out <file>", "write the generated player type to a JSON file")
  .option("--json", "print JSON")
  .description("Generate a missing-bonus player type and make it current.")
  .action(async (preset: string, options: GenerateOptions) => {
    await failHandled(async () => {
      const playerCase = makeCase(preset);
      await saveCurrentCase(playerCase);
      await saveCurrentSignals(calculateSignals(playerCase));

      if (options.out) {
        await writeCaseToFile(options.out, playerCase);
      }

      if (options.json) {
        printJson(playerCase);
        return;
      }

      headline("PLAYER TYPE GENERATED");
      printCase(playerCase);
      console.log("");
      console.log(success(`Saved current player type in ${stateSummary().stateDir}`));
      if (options.out) console.log(success(`Wrote ${options.out}`));
    });
  });

program
  .command("signals")
  .argument("[playerTypeFile]", "player type JSON file; defaults to the current player type")
  .option("--json", "print JSON")
  .description("Calculate deterministic governed bonus signals.")
  .action(async (caseFile: string | undefined, options: SignalsOptions) => {
    await failHandled(async () => {
      const playerCase = await resolveCase(caseFile);
      const signals = calculateSignals(playerCase);
      await saveCurrentSignals(signals);

      if (options.json) {
        printJson(signals);
        return;
      }

      headline("SIGNAL LAYER");
      printSignalLayerExplainer();
      printSignals(getSourceSignals(signals));
      console.log("");
      console.log(success("Signals saved for the current player type."));
    });
  });

program
  .command("run")
  .argument("[playerTypeFile]", "player type JSON file; defaults to the current player type")
  .option("--offline", "run deterministic local simulation instead of OpenAI/LangChain")
  .option("--model <model>", "override OPENAI_MODEL for this run")
  .option("--json", "print JSON")
  .description("Run the Bonus Resolution Agent and persist a replayable run record.")
  .action(async (caseFile: string | undefined, options: RunOptions) => {
    await failHandled(async () => {
      const playerCase = await resolveCase(caseFile);
      const record = await executeRun(playerCase, options);

      if (options.json) {
        printJson(record);
        return;
      }

      headline("AGENT RUN");
      printRunRecord(record);
      console.log("");
      if (record.status === "completed") {
        console.log(success(`Trace saved as ${record.runId}`));
      } else {
        console.log(failure(`Run failed and was saved as ${record.runId}`));
        process.exitCode = 1;
      }
    });
  });

program
  .command("trace")
  .argument("[runId]", "run ID; defaults to current")
  .option("--json", "print JSON")
  .option("--tool-details", "show tool argument/result JSON")
  .description("Display the persisted execution trace.")
  .action(async (runId: string | undefined, options: TraceOptions) => {
    await failHandled(async () => {
      const record = await readRunRecord(runId);
      if (options.json) {
        printJson(record);
        return;
      }
      headline("TRACE LOG");
      printRunRecord(record);
      console.log("");
      if (record.result) {
        printToolCalls(record.result.toolCalls, { showJsonDetails: options.toolDetails });
        console.log("");
        printTrace(record.result.trace);
      }
    });
  });

program
  .command("replay")
  .argument("[runId]", "run ID; defaults to current")
  .option("--tool-details", "show tool argument/result JSON")
  .description("Replay the stage-by-stage execution story from a persisted run.")
  .action(async (runId: string | undefined, options: ReplayOptions) => {
    await failHandled(async () => {
      const record = await readRunRecord(runId);
      await replayRecord(record, options);
    });
  });

program
  .command("metrics")
  .option("--json", "print JSON")
  .description("Display aggregate deflection and re-open metrics from saved runs.")
  .action(async (options: { json?: boolean }) => {
    await failHandled(async () => {
      const metrics = aggregateMetrics(await listRunRecords());
      if (options.json) {
        printJson(metrics);
        return;
      }

      headline("OUTCOME METRICS");
      console.log(`Total complaints:  ${metrics.totalComplaints}`);
      console.log(`Deflected:         ${metrics.deflected}`);
      console.log(`Human escalated:   ${metrics.humanEscalated}`);
      console.log(`Reopened:          ${metrics.reopened}`);
      console.log(`Deflection rate:   ${formatPercent(metrics.deflectionRate)}`);
      console.log(`Re-open rate:      ${formatPercent(metrics.reopenRate)}`);
      console.log("");
      console.log("By outcome");
      Object.entries(metrics.byOutcome).forEach(([key, value]) => {
        console.log(`- ${key}: ${value}`);
      });
      console.log("");
      console.log("By operator");
      Object.entries(metrics.byOperator).forEach(([key, value]) => {
        console.log(`- ${key}: ${value}`);
      });
      console.log("");
      console.log("By campaign");
      Object.entries(metrics.byCampaign).forEach(([key, value]) => {
        console.log(`- ${key}: ${value}`);
      });
    });
  });

program
  .command("catalog")
  .description("Display all governed signal definitions for the current player type.")
  .action(async () => {
    await failHandled(async () => {
      const signals = await resolveSignals();
      headline("SIGNAL CATALOG");
      printCatalog(getSourceSignals(signals));
    });
  });

program
  .command("explain")
  .argument("<signalName>", "signal name, for example \"Bonus Eligibility Signal\"")
  .description("Explain one governed signal.")
  .action(async (signalName: string) => {
    await failHandled(async () => {
      const signals = await resolveSignals();
      headline("SIGNAL EXPLANATION");
      printSignalExplanation(getSignal(signals, signalName));
    });
  });

program
  .command("test-ai")
  .option("--model <model>", "model to test; defaults to OPENAI_MODEL")
  .description("Test OpenAI key loading, model visibility, and one minimal generation request.")
  .action(async (options: { model?: string }) => {
    await failHandled(async () => {
      await testAIConnection(options.model || process.env.OPENAI_MODEL || "gpt-5.5");
    });
  });

program
  .command("demo")
  .argument("<playerType>", "eligible | expired | claimed | mismatch | wagering | blocked | random")
  .option("--offline", "run deterministic local simulation instead of OpenAI/LangChain")
  .option("--model <model>", "override OPENAI_MODEL for this run")
  .option("--deposit <eur>", "set deposit amount for the demo player type")
  .option("--step", "pause between stages when running in an interactive terminal")
  .option("--tool-details", "show tool argument/result JSON in the audit stage")
  .option("--json", "print final run record JSON")
  .description("Walk the interview demo stage by stage.")
  .action(async (preset: string, options: DemoOptions) => {
    await failHandled(async () => {
      const record = await runDemoFlow(preset, options);
      if (options.json) printJson(record);
    });
  });

program
  .command("studio")
  .option("--live", "start in live LangChain/OpenAI mode")
  .option("--offline", "start in deterministic offline mode")
  .option("--model <model>", "override OPENAI_MODEL for live runs")
  .description("Open an interactive step-by-step BlockLabs Agent Studio menu.")
  .action(async (options: StudioOptions) => {
    await failHandled(async () => {
      await runStudio(options);
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(failure(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});

async function executeRun(playerCase: PlayerCase, options: RunOptions): Promise<CliRunRecord> {
  const mode: CliRunMode = options.offline ? "offline" : "live";
  const runId = makeRunId(playerCase.playerId);
  const signals = calculateSignals(playerCase);
  const memory = await readMemory(playerCase.playerId);

  await saveCurrentSignals(signals);

  if (options.model) {
    process.env.OPENAI_MODEL = options.model;
  }

  const spinner = options.json
    ? null
    : ora(
      mode === "live"
        ? "Waiting on LangChain + OpenAI live API response. No offline fallback will run."
        : "Running deterministic offline simulation locally.",
    ).start();

  try {
    const sourceSignals = getSourceSignals(signals);
    const result = options.offline
      ? runBonusResolutionAgent({ case: playerCase, signals: sourceSignals, memory })
      : await runLangChainBonusResolutionAgent({ case: playerCase, signals: sourceSignals, memory });

    spinner?.succeed(mode === "live" ? "LangChain + OpenAI run completed" : "Offline simulation completed");
    await saveMemory(result);

    const record: CliRunRecord = {
      runId,
      createdAt: new Date().toISOString(),
      mode,
      status: "completed",
      playerCase,
      signals,
      result,
    };
    await saveRunRecord(record);
    return record;
  } catch (error) {
    spinner?.fail(mode === "live" ? "LangChain + OpenAI live API request failed" : "Offline simulation failed");

    const record: CliRunRecord = {
      runId,
      createdAt: new Date().toISOString(),
      mode,
      status: "failed",
      playerCase,
      signals,
      error: {
        title: "LangChain/OpenAI run failed",
        detail: error instanceof Error ? error.message : String(error),
        provider: "openai",
        model: process.env.OPENAI_MODEL || "gpt-5.5",
      },
    };
    await saveRunRecord(record);
    return record;
  }
}

async function runDemoFlow(preset: string, options: DemoOptions): Promise<CliRunRecord | null> {
  let playerCase = makeCase(preset);
  if (options.deposit) {
    playerCase = withBonusDepositAmount(playerCase, parseDepositAmount(options.deposit));
  }
  const scenario = scenarioLabel(preset);

  stage(1, "Who is the player?");
  printCaseSummary(playerCase, scenario);
  await pauseStep(options);

  stage(2, "What bonus are they missing?");
  console.log(`${playerCase.playerId} says "${playerCase.campaign.campaignName}" was not credited.`);
  if (options.chooseDeposit) {
    console.log(muted("Demo control: choose the attached deposit evidence."));
    playerCase = withBonusDepositAmount(
      playerCase,
      await options.chooseDeposit(playerCase.payments.depositAmount),
    );
  }
  await saveCurrentCase(playerCase);
  console.log("");
  console.log("Attached deposit evidence");
  console.log(`Deposit:  ${formatMoney(playerCase.payments.depositAmount)}`);
  console.log(`Code:     ${playerCase.campaign.playerEnteredBonusCode ?? "missing"}`);
  console.log(`Campaign: ${playerCase.campaign.campaignId}`);
  console.log(muted("The Bonus Eligibility Signal will answer whether this evidence satisfies governed campaign policy."));
  await pauseStep(options);

  stage(3, "What do we already know from our systems?");
  console.log("Campaign, deposit, CRM, KYC, risk, player-safety, and bonus-ledger data converge into one reviewable case:");
  console.log("");
  printSourceSystems(playerCase);
  await pauseStep(options);

  stage(4, "What Signals does this give us?");
  const signals = calculateSignals(playerCase);
  await saveCurrentSignals(signals);
  const bonusEligibility = getSignal(signals, "Bonus Eligibility Signal");
  console.log("Bonus Eligibility Signal answer");
  console.log(`Outcome: ${bonusEligibility.outcomeCode ?? "UNSET"}`);
  console.log(`Reason:  ${bonusEligibility.explanation.join(" ")}`);
  console.log("");
  printSignalLayerExplainer();
  printSignals(getSourceSignals(signals));
  await pauseStep(options);

  stage(5, "Which LangChain AI agents can use these signals?");
  console.log("LangChain is used here as the agent orchestration layer.");
  console.log(muted("It wraps ChatOpenAI, registers approved tools, runs the model/tool-call loop, and returns messages, tool calls, and trace evidence."));
  console.log(muted("It does not invent signals, change eligibility, or override server guardrails."));
  console.log("");
  printAgentConsumers(getAgentSignalConsumers(signals));
  console.log("");
  const record = await executeRun(playerCase, options);
  if (record.status === "failed") {
    printRunRecord(record);
    console.log("");
    console.log(failure("No agent decision was made. Use offline mode for deterministic simulation, or fix the live OpenAI key/quota."));
    if (options.setExitCodeOnFailure !== false) {
      process.exitCode = 1;
    }
    return record;
  }

  if (!record.result) throw new Error("Completed run did not include an agent result.");
  console.log(record.result.executionMode === "langchain_openai" ? "LangChain + OpenAI selected bounded tools." : "Offline deterministic simulation selected bounded tools.");
  record.result.toolCalls.forEach((call) => {
    console.log(`- ${call.toolName}`);
  });
  await pauseStep(options);

  stage(6, "What action is safe?");
  printDecision(record.result);
  await pauseStep(options);

  stage(7, "Can we prove the result and measure performance?");
  printToolCalls(record.result.toolCalls, { showJsonDetails: options.toolDetails });
  console.log("");
  printTrace(record.result.trace);
  console.log("");
  printOutcomeMetrics(record.result);
  console.log("");
  console.log(success(`Replayable run saved as ${record.runId}`));
  return record;
}

async function runStudio(options: StudioOptions) {
  const rl = createInterface({ input, output });
  const state = {
    offline: options.live ? false : true,
    model: options.model || process.env.OPENAI_MODEL || "gpt-5.5",
  };

  if (options.offline) state.offline = true;

  try {
    headline("BLOCKLABS LANGCHAIN AGENT STUDIO");
    console.log("Interactive proof layer for the Bonus Resolution Agent.");
    console.log(muted("Starts in deterministic offline mode. Toggle live mode when the OpenAI key/quota is ready."));

    let shouldExit = false;
    while (!shouldExit) {
      const choice = await selectMenu(
        rl,
        [
          "BLOCKLABS LANGCHAIN AGENT STUDIO",
          `Mode: ${state.offline ? "offline deterministic" : `live ${state.model}`}`,
        ],
        [
          { shortcut: "1", label: "Guided demo", value: "demo" },
          { shortcut: "2", label: "Generate/select player type", value: "generate" },
          { shortcut: "3", label: "View current player type", value: "case" },
          { shortcut: "4", label: "Calculate/view signals", value: "signals" },
          { shortcut: "5", label: "Run agent", value: "run" },
          { shortcut: "6", label: "View trace", value: "trace" },
          { shortcut: "7", label: "Replay run", value: "replay" },
          { shortcut: "8", label: "Metrics", value: "metrics" },
          { shortcut: "9", label: "Signal catalog", value: "catalog" },
          { shortcut: "10", label: "Test AI connection", value: "test-ai" },
          { shortcut: "11", label: "Explain signal", value: "explain" },
          { shortcut: "12", label: "Toggle live/offline", value: "mode" },
          { shortcut: "13", label: "Set live model", value: "model" },
          { shortcut: "0", label: "Exit", value: "exit" },
        ],
        { cancelValue: "exit" },
      );

      switch (choice) {
        case "demo":
          await studioGuidedDemo(rl, state);
          break;
        case "generate":
          await studioGenerateCase(rl);
          break;
        case "case":
          await studioViewCase(rl);
          break;
        case "signals":
          await studioSignals(rl);
          break;
        case "run":
          await studioRunAgent(rl, state);
          break;
        case "trace":
          await studioTrace(rl);
          break;
        case "replay":
          await studioReplay(rl);
          break;
        case "metrics":
          await studioMetrics(rl);
          break;
        case "catalog":
          await studioCatalog(rl);
          break;
        case "test-ai":
          await studioTestAIConnection(rl, state);
          break;
        case "explain":
          await studioExplain(rl);
          break;
        case "mode":
          state.offline = !state.offline;
          console.log(success(`Mode set to ${state.offline ? "offline deterministic" : `live LangChain/OpenAI (${state.model})`}.`));
          await pauseStudio(rl);
          break;
        case "model":
          state.model = await ask(rl, `Model [${state.model}]: `) || state.model;
          console.log(success(`Live model set to ${state.model}.`));
          await pauseStudio(rl);
          break;
        case "exit":
          shouldExit = true;
          break;
        default:
          console.log(warning("Unknown option."));
          await pauseStudio(rl);
      }
    }
  } finally {
    rl.close();
  }
}

async function studioGuidedDemo(
  rl: Interface,
  state: { offline: boolean; model: string },
) {
  await studioAction(rl, async () => {
    const preset = await choosePreset(rl);
    if (!preset) return;
    await runDemoFlow(preset, {
      offline: state.offline,
      model: state.model,
      step: true,
      pause: () => pauseStudioStep(rl),
      chooseDeposit: (currentAmount) => chooseDepositAmount(rl, currentAmount),
      setExitCodeOnFailure: false,
    });
  }, false);
}

async function studioGenerateCase(rl: Interface) {
  await studioAction(rl, async () => {
    const preset = await choosePreset(rl);
    if (!preset) return;

    const playerCase = makeCase(preset);
    await saveCurrentCase(playerCase);
    await saveCurrentSignals(calculateSignals(playerCase));

    headline("PLAYER TYPE GENERATED");
    printCase(playerCase);
    console.log("");
    console.log(success(`Saved current player type in ${stateSummary().stateDir}`));
  });
}

async function studioViewCase(rl: Interface) {
  await studioAction(rl, async () => {
    const playerCase = await readCurrentCase();
    headline("CURRENT PLAYER TYPE");
    printCase(playerCase);
  });
}

async function studioSignals(rl: Interface) {
  await studioAction(rl, async () => {
    const playerCase = await readCurrentCase();
    const signals = calculateSignals(playerCase);
    await saveCurrentSignals(signals);
    headline("SIGNAL LAYER");
    printSignalLayerExplainer();
    printSignals(getSourceSignals(signals));
  });
}

async function studioRunAgent(
  rl: Interface,
  state: { offline: boolean; model: string },
) {
  await studioAction(rl, async () => {
    const playerCase = await readCurrentCase();
    const record = await executeRun(playerCase, {
      offline: state.offline,
      model: state.model,
    });
    headline("AGENT RUN");
    printRunRecord(record);
    if (record.status === "failed") {
      console.log("");
      console.log(failure("No agent decision was made. Toggle offline mode to run the deterministic simulation."));
    }
  });
}

async function studioTestAIConnection(
  rl: Interface,
  state: { model: string },
) {
  await studioAction(rl, async () => {
    await testAIConnection(state.model);
  });
}

async function studioTrace(rl: Interface) {
  await studioAction(rl, async () => {
    const record = await readRunRecord();
    headline("TRACE LOG");
    printRunRecord(record);
    if (record.result) {
      console.log("");
      printTrace(record.result.trace);
    }
  });
}

async function studioReplay(rl: Interface) {
  await studioAction(rl, async () => {
    const record = await readRunRecord();
    await replayRecord(record);
  });
}

async function studioMetrics(rl: Interface) {
  await studioAction(rl, async () => {
    const metrics = aggregateMetrics(await listRunRecords());
    headline("OUTCOME METRICS");
    console.log(`Total complaints:  ${metrics.totalComplaints}`);
    console.log(`Deflection rate:   ${formatPercent(metrics.deflectionRate)}`);
    console.log(`Re-open rate:      ${formatPercent(metrics.reopenRate)}`);
    console.log(`Human escalated:   ${metrics.humanEscalated}`);
  });
}

async function studioCatalog(rl: Interface) {
  await studioAction(rl, async () => {
    const signals = await resolveSignals();
    headline("SIGNAL CATALOG");
    printCatalog(getSourceSignals(signals));
  });
}

async function studioExplain(rl: Interface) {
  await studioAction(rl, async () => {
    const signals = await resolveSignals();
    const signalName = await chooseSignal(rl, signals);
    if (!signalName) return;
    headline("SIGNAL EXPLANATION");
    printSignalExplanation(getSignal(signals, signalName));
  });
}

async function studioAction(
  rl: Interface,
  action: () => Promise<void>,
  pauseAfter = true,
) {
  try {
    await action();
  } catch (error) {
    console.log(failure(error instanceof Error ? error.message : String(error)));
  }

  if (pauseAfter) {
    await pauseStudio(rl);
  }
}

async function choosePreset(rl: Interface): Promise<string | null> {
  const choice = await selectMenu(
    rl,
    ["Choose a player type"],
    [
      { shortcut: "1", label: "Eligible Verified Player", value: "eligible" },
      { shortcut: "2", label: "Campaign Expired", value: "expired" },
      { shortcut: "3", label: "Already Claimed Bonus", value: "claimed" },
      { shortcut: "4", label: "Deposit / Code Mismatch", value: "mismatch" },
      { shortcut: "5", label: "Wagering Incomplete", value: "wagering" },
      { shortcut: "6", label: "Risk or RG Blocked", value: "blocked" },
      { shortcut: "7", label: "Random Scenario", value: "random" },
      { shortcut: "0", label: "Cancel", value: "cancel" },
    ],
    { cancelValue: "cancel" },
  );

  return choice === "cancel" ? null : choice;
}

async function chooseDepositAmount(rl: Interface, currentAmount: number): Promise<number> {
  const amountItems = BONUS_DEPOSIT_OPTIONS.map((amount, index) => ({
    shortcut: String(index + 1),
    label: formatMoney(amount),
    value: String(amount),
  }));
  const choice = await selectMenu(
    rl,
    [],
    amountItems,
    {
      initialIndex: Math.max(
        BONUS_DEPOSIT_OPTIONS.findIndex((amount) => amount === currentAmount),
        0,
      ),
    },
  );

  return parseDepositAmount(choice);
}

async function chooseSignal(rl: Interface, signals: Signal[]): Promise<string | null> {
  const sourceSignals = getSourceSignals(signals);
  const choice = await selectMenu(
    rl,
    ["Choose a signal"],
    [
      ...sourceSignals.map((signal, index) => ({
        shortcut: String(index + 1),
        label: signal.name,
        value: signal.name,
      })),
      { shortcut: "0", label: "Cancel", value: "cancel" },
    ],
    { cancelValue: "cancel" },
  );

  return choice === "cancel" ? null : choice;
}

async function selectMenu<T extends string>(
  rl: Interface,
  title: string[],
  items: MenuItem<T>[],
  options: { cancelValue?: T; initialIndex?: number } = {},
): Promise<T> {
  if (!input.isTTY || !output.isTTY) {
    return selectMenuFallback(rl, title, items, options);
  }

  rl.pause();
  emitKeypressEvents(input);

  const previousRawMode = input.isRaw;
  input.setRawMode(true);
  input.resume();

  let selectedIndex = Math.min(
    Math.max(options.initialIndex ?? 0, 0),
    items.length - 1,
  );
  let renderedLines = 0;

  return new Promise<T>((resolve) => {
    const render = () => {
      if (renderedLines > 0) {
        moveCursor(output, 0, -renderedLines);
        cursorTo(output, 0);
        clearScreenDown(output);
      }

      const lines = [
        "",
        ...(title.length ? [...title, ""] : []),
        ...items.map((item, index) => {
          const pointer = index === selectedIndex ? success(">") : " ";
          const shortcut = item.shortcut ? `${item.shortcut.padEnd(2)} ` : "   ";
          const label = index === selectedIndex ? success(item.label) : item.label;
          return `${pointer} ${shortcut}${label}`;
        }),
      ];

      output.write(`${lines.join("\n")}\n`);
      renderedLines = lines.length;
    };

    const cleanup = (value: T) => {
      input.off("keypress", onKeypress);
      input.setRawMode(previousRawMode);
      rl.resume();
      output.write("\n");
      resolve(value);
    };

    const cancel = () => {
      cleanup(options.cancelValue ?? items[selectedIndex].value);
    };

    const onKeypress = (str: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        input.setRawMode(previousRawMode);
        output.write("\n");
        process.exit(130);
      }

      if (key.name === "up") {
        selectedIndex = selectedIndex === 0 ? items.length - 1 : selectedIndex - 1;
        render();
        return;
      }

      if (key.name === "down") {
        selectedIndex = selectedIndex === items.length - 1 ? 0 : selectedIndex + 1;
        render();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup(items[selectedIndex].value);
        return;
      }

      if (key.name === "escape" || str?.toLowerCase() === "q") {
        cancel();
        return;
      }

      const shortcutIndex = items.findIndex((item) => item.shortcut === str);
      if (shortcutIndex !== -1) {
        cleanup(items[shortcutIndex].value);
      }
    };

    input.on("keypress", onKeypress);
    render();
  });
}

async function selectMenuFallback<T extends string>(
  rl: Interface,
  title: string[],
  items: MenuItem<T>[],
  options: { cancelValue?: T },
): Promise<T> {
  console.log("");
  title.forEach((line) => console.log(line));
  items.forEach((item, index) => {
    console.log(`${item.shortcut ?? String(index + 1)}  ${item.label}`);
  });

  const raw = (await ask(rl, "Choose an option: ")).toLowerCase();
  if ((raw === "q" || raw === "escape") && options.cancelValue) {
    return options.cancelValue;
  }

  const match = items.find((item, index) => {
    return (
      item.shortcut?.toLowerCase() === raw ||
      item.value.toLowerCase() === raw ||
      item.label.toLowerCase() === raw ||
      String(index + 1) === raw
    );
  });

  if (!match) {
    return options.cancelValue ?? items[0].value;
  }

  return match.value;
}

async function ask(rl: Interface, prompt: string) {
  return (await rl.question(prompt)).trim();
}

async function pauseStudio(rl: Interface) {
  await rl.question(muted("\nWaiting for you: press Enter to return to menu..."));
}

async function pauseStudioStep(rl: Interface) {
  await rl.question(muted("\nWaiting for you: press Enter for next stage..."));
  console.log("");
}

async function resolveCase(caseFile?: string): Promise<PlayerCase> {
  if (caseFile) return loadCaseFromFile(caseFile);
  return readCurrentCase();
}

async function resolveSignals(): Promise<Signal[]> {
  const current = await readCurrentSignals();
  if (current) return current;

  const playerCase = await readCurrentCase();
  const signals = calculateSignals(playerCase);
  await saveCurrentSignals(signals);
  return signals;
}

function makeCase(preset: string) {
  if (preset === "random") return generateRandomCase();
  return getPresetCase(resolvePresetKey(preset));
}

function scenarioLabel(preset: string) {
  if (preset === "random") return "Random Scenario";
  const key = resolvePresetKey(preset);
  return presetCases.find((item) => item.key === key)?.label ?? key;
}

function parseDepositAmount(value: string): number {
  const normalized = value.replace(/[,_€\s]/g, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid deposit amount "${value}".`);
  }
  return Math.round(amount);
}

function resolvePresetKey(value: string): PresetKey {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, PresetKey> = {
    eligible: "eligible",
    verified: "eligible",
    "eligible-verified": "eligible",
    "eligible-verified-player": "eligible",
    "trusted-vip": "eligible",
    "clean-vip": "eligible",
    cleanvip: "eligible",
    clean: "eligible",
    trusted: "eligible",
    expired: "expired",
    "campaign-expired": "expired",
    "expired-campaign": "expired",
    claimed: "claimed",
    "already-claimed": "claimed",
    "already-claimed-bonus": "claimed",
    mismatch: "mismatch",
    "deposit-mismatch": "mismatch",
    "code-mismatch": "mismatch",
    "deposit-code-mismatch": "mismatch",
    "deposit/code-mismatch": "mismatch",
    wagering: "wagering",
    "wagering-incomplete": "wagering",
    blocked: "blocked",
    risk: "blocked",
    "risk-blocked": "blocked",
    "rg-blocked": "blocked",
    "risk-or-rg-blocked": "blocked",
    underage: "blocked",
    "vip-risk": "blocked",
    "vip-risky": "blocked",
    "vip-but-risky": "blocked",
    viprisky: "blocked",
    "rg-risk": "blocked",
    "responsible-gaming": "blocked",
    "responsible-gaming-risk": "blocked",
    responsiblegaming: "blocked",
    fraud: "blocked",
    "fraud-risk": "blocked",
    "bonus-abuse": "blocked",
  };

  const match = aliases[normalized];
  if (!match) {
    const allowed = [
      "random",
      "eligible",
      "expired",
      "claimed",
      "mismatch",
      "wagering",
      "blocked",
    ].join(", ");
    throw new Error(`Unknown player type "${value}". Use one of: ${allowed}`);
  }
  return match;
}

function printSignalLayerExplainer() {
  console.log(muted(signalLayerExplainer));
  console.log("");
}

async function replayRecord(
  record: CliRunRecord,
  options: ReplayOptions = {},
) {
  stage(1, "Player reported a missing bonus");
  printCaseSummary(record.playerCase);
  console.log(`${record.playerCase.playerId} says ${record.playerCase.campaign.campaignName} was not credited.`);

  stage(2, "Deterministic signals were calculated");
  printSignalLayerExplainer();
  printSignals(getSourceSignals(record.signals));

  stage(3, "Agent execution");
  if (record.result) {
    printAgentConsumers(getAgentSignalConsumers(record.signals));
    console.log("");
    console.log(record.result.executionMode === "langchain_openai" ? "LangChain + OpenAI selected bounded tools." : "Offline deterministic simulation selected bounded tools.");
    printToolCalls(record.result.toolCalls, { showJsonDetails: options.toolDetails });
  } else {
    console.log(failure(record.error?.title ?? "Run failed"));
    console.log(record.error?.detail ?? "No error detail recorded.");
  }

  stage(4, "Decision, audit trace, and metrics");
  if (record.result) {
    printDecision(record.result);
    console.log("");
    printTrace(record.result.trace);
    console.log("");
    printOutcomeMetrics(record.result);
  }
}

async function testAIConnection(model: string) {
  const apiKey = process.env.OPENAI_API_KEY;

  headline("AI CONNECTION TEST");
  console.log(`Model: ${model}`);

  if (!apiKey) {
    console.log(failure("OPENAI_API_KEY is not configured."));
    console.log(muted("Add it to .env.local, then rerun this test."));
    return;
  }

  console.log(`Key:   ${describeOpenAIKey(apiKey)}`);
  console.log("");

  const modelsSpinner = ora("Checking OpenAI authentication and model list").start();
  const modelsResponse = await callOpenAI("/models", apiKey);

  if (!modelsResponse.ok) {
    modelsSpinner.fail("OpenAI authentication/model-list request failed");
    printOpenAIResponseFailure(modelsResponse);
    return;
  }

  modelsSpinner.succeed("OpenAI authentication works");
  const modelIds = extractModelIds(modelsResponse.payload);
  if (modelIds.includes(model)) {
    console.log(success(`Model visible: ${model}`));
  } else {
    console.log(warning(`Model not present in /v1/models: ${model}`));
    console.log(muted("The generation request will still be attempted, because model lists can lag entitlement changes."));
  }

  const generationSpinner = ora(`Sending minimal generation request to ${model}`).start();
  const generationResponse = await callOpenAI("/responses", apiKey, {
    method: "POST",
    body: JSON.stringify({
      model,
      input: "Return exactly OK.",
    }),
  });

  if (!generationResponse.ok) {
    generationSpinner.fail("OpenAI generation request failed");
    printOpenAIResponseFailure(generationResponse);
    const errorPayload = generationResponse.payload as OpenAIErrorPayload;
    if (errorPayload.error?.code === "insufficient_quota") {
      console.log("");
      console.log(warning("Diagnosis: the key is valid, but this project/org has no usable generation quota."));
    }
    return;
  }

  generationSpinner.succeed("OpenAI generation request works");
  console.log(success("Live AI connection is ready for the LangChain agent."));
}

async function callOpenAI(
  pathName: string,
  apiKey: string,
  init: RequestInit = {},
): Promise<OpenAIResponse> {
  const response = await fetch(`https://api.openai.com/v1${pathName}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    payload = text.slice(0, 800);
  }
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

function describeOpenAIKey(apiKey: string) {
  if (apiKey.length <= 12) return "configured";
  return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
}

function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = (item as { id?: unknown }).id;
      return typeof id === "string" ? id : null;
    })
    .filter((id): id is string => Boolean(id));
}

function printOpenAIResponseFailure(response: OpenAIResponse) {
  console.log(failure(`Status: ${response.status}`));
  const errorPayload = response.payload as OpenAIErrorPayload;
  if (errorPayload.error) {
    if (errorPayload.error.type) console.log(`Type:   ${errorPayload.error.type}`);
    if (errorPayload.error.code) console.log(`Code:   ${errorPayload.error.code}`);
    if (errorPayload.error.message) console.log(`Detail: ${errorPayload.error.message}`);
    return;
  }
  console.log(typeof response.payload === "string" ? response.payload : JSON.stringify(response.payload, null, 2));
}

async function pauseStep(options: DemoOptions) {
  if (options.pause) {
    await options.pause();
    return;
  }
  await maybePause(options.step);
}

async function maybePause(enabled?: boolean) {
  if (!enabled || !process.stdin.isTTY) return;
  process.stdout.write(muted("\nWaiting for you: press Enter for next stage..."));
  process.stdin.resume();
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });
  console.log("");
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), fileName);
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

async function failHandled(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.error(failure(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
