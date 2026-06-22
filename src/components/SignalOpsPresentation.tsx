"use client";

import {
  Activity,
  BadgeCheck,
  Braces,
  CheckCircle2,
  ChevronsRight,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  FileText,
  Gauge,
  Gift,
  History,
  LoaderCircle,
  Megaphone,
  Play,
  ShieldAlert,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  BONUS_DEPOSIT_OPTIONS,
  cloneCase,
  generateRandomCase,
  getPresetCase,
  presetCases,
  type PresetKey,
  withBonusDepositAmount,
} from "@/lib/cases";
import { getAgentSignalConsumers } from "@/lib/signalConsumers";
import { getSignalTone, type SignalTone } from "@/lib/signalDisplay";
import {
  calculateSignals,
  getDecisionSignals,
  getSignal,
  getSourceSignals,
} from "@/lib/signals";
import type {
  AgentMemory,
  AgentRunResult,
  PlayerCase,
  Signal,
  ToolCallLog,
  TraceEvent,
} from "@/lib/types";

const signalToneStyles: Record<SignalTone, string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-950",
  info: "border-sky-200 bg-sky-50 text-sky-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  danger: "border-orange-200 bg-orange-50 text-orange-950",
  critical: "border-red-200 bg-red-50 text-red-950",
};

const sourceToneStyles = {
  neutral: "border-stone-200 bg-stone-50",
  green: "border-emerald-200 bg-emerald-50",
  amber: "border-amber-200 bg-amber-50",
  red: "border-red-200 bg-red-50",
  blue: "border-sky-200 bg-sky-50",
};

const statusLabels: Record<AgentRunResult["decision"]["status"], string> = {
  bonus_granted: "Bonus Granted",
  denied: "Denied",
  human_escalation: "Human Escalation",
  kyc_required: "KYC Required",
  responsible_gaming_review: "RG Review",
};

const signalBusinessDomains = [
  "Regulation",
  "Compliance",
  "Risk Management",
  "Operations",
  "Finance",
  "Product",
];

const langChainRuntimeSteps = [
  {
    label: "Signal",
    detail: "Fetch the governed Bonus Eligibility Signal.",
  },
  {
    label: "Tools",
    detail: "Choose only approved resolution tools.",
  },
  {
    label: "Message",
    detail: "Write player-facing response or escalation summary.",
  },
  {
    label: "Trace",
    detail: "Return tool calls, decision, and metrics.",
  },
];

type SelectedPresetKey = PresetKey | "random" | null;

type AgentApiError = {
  error?: string;
  detail?: string;
  provider?: string;
  model?: string;
  offlineModeAvailable?: boolean;
  offlineModeHint?: string;
};

const playerTypeCopy: Record<PresetKey, { label: string; detail: string }> = {
  eligible: {
    label: "Eligible Verified Player",
    detail: "Verified player and qualifying campaign data",
  },
  expired: {
    label: "Campaign Expired",
    detail: "Campaign window and grace period closed",
  },
  claimed: {
    label: "Already Claimed Bonus",
    detail: "Ledger shows bonus was already credited",
  },
  mismatch: {
    label: "Deposit / Code Mismatch",
    detail: "Deposit or entered code fails campaign policy",
  },
  wagering: {
    label: "Wagering Incomplete",
    detail: "Bonus ledger shows wagering is not complete",
  },
  blocked: {
    label: "Risk or RG Blocked",
    detail: "Risk or player-safety signals block resolution",
  },
};

const anonymousSlots: Record<PresetKey, string> = {
  eligible: "Player A",
  expired: "Player B",
  claimed: "Player C",
  mismatch: "Player D",
  wagering: "Player E",
  blocked: "Player F",
};

function selectedPlayerCopy(selectedPreset: Exclude<SelectedPresetKey, null>) {
  return selectedPreset === "random"
    ? { label: "Random Scenario", detail: "Generated missing-bonus complaint" }
    : playerTypeCopy[selectedPreset];
}

function selectedIntent(selectedPreset: Exclude<SelectedPresetKey, null>) {
  return selectedPreset === "random"
    ? "Randomized input proves the same signal contract works across player types."
    : presetCases.find((preset) => preset.key === selectedPreset)?.intent ?? "";
}

function money(value: number, currency = "EUR"): string {
  return `${currency} ${value.toLocaleString()}`;
}

function shortDateTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function shortTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function boolLabel(value: boolean): string {
  return value ? "Yes" : "No";
}

function metricLabel(value: boolean) {
  return value ? "Yes" : "No";
}

function Panel({
  title,
  eyebrow,
  children,
  icon,
  className = "",
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-lg border border-stone-300 bg-white shadow-sm ${className}`}>
      <div className="border-b border-stone-300 bg-white px-5 py-5">
        <div className="flex min-w-0 items-center gap-4">
          {icon ? (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-stone-300 bg-stone-950 text-white">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            {eyebrow ? (
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                {eyebrow}
              </p>
            ) : null}
            <h2 className="mt-1 text-2xl font-semibold leading-tight text-stone-950">
              {title}
            </h2>
          </div>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function FlowHeader() {
  return (
    <section className="border-b border-white/10 bg-[#111827] px-5 py-5 text-white lg:px-8">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded border border-amber-300/30 bg-amber-300/10 text-amber-200">
          <Gift size={18} />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
          BlockLabs LangChain Agent Studio
        </p>
      </div>
      <h1 className="max-w-5xl text-3xl font-semibold leading-tight md:text-4xl">
        Missing bonus resolution, governed by one eligibility signal.
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-300">
        Player complaint, source systems, deterministic signal, LangChain tool choice, safe action, trace, and operational metrics.
      </p>
    </section>
  );
}

function StoryLabel({
  number,
  question,
  detail,
}: {
  number: string;
  question: string;
  detail?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        {number}
      </span>
      <h3 className="text-base font-semibold text-stone-950">{question}</h3>
      {detail ? <p className="text-sm leading-6 text-stone-600">{detail}</p> : null}
    </div>
  );
}

function PlayerChooser({
  selectedPreset,
  setPreset,
  randomize,
  isRunning,
}: {
  selectedPreset: SelectedPresetKey;
  setPreset: (key: PresetKey) => void;
  randomize: () => void;
  isRunning: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <button
        aria-pressed={selectedPreset === "random"}
        className={`flex min-h-14 items-center gap-3 rounded-lg border p-3 text-left transition ${
          selectedPreset === "random"
            ? "border-stone-950 bg-stone-950 text-white shadow-sm"
            : "border-stone-200 bg-stone-50 text-stone-700 hover:border-stone-400 disabled:cursor-wait disabled:opacity-60"
        }`}
        disabled={isRunning}
        onClick={randomize}
        type="button"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-current/20 bg-white/10">
          <Sparkles size={16} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Random Scenario</span>
          {selectedPreset === "random" ? (
            <span className="block text-xs leading-4 opacity-75">Generated missing-bonus complaint</span>
          ) : null}
        </span>
      </button>
      {presetCases.map((preset) => {
        const copy = playerTypeCopy[preset.key];
        const isSelected = selectedPreset === preset.key;
        const visibleLabel = isSelected ? copy.label : anonymousSlots[preset.key];

        return (
          <button
            aria-pressed={isSelected}
            className={`flex min-h-14 items-center gap-3 rounded-lg border p-3 text-left transition ${
              isSelected
                ? "border-stone-950 bg-stone-950 text-white shadow-sm"
                : "border-stone-200 bg-stone-50 text-stone-700 hover:border-stone-400 disabled:cursor-wait disabled:opacity-60"
            }`}
            disabled={isRunning}
            key={preset.key}
            onClick={() => setPreset(preset.key)}
            type="button"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-current/20 bg-white/10">
              <UserRound size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{visibleLabel}</span>
              {isSelected ? (
                <span className="block text-xs leading-4 opacity-75">{copy.detail}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DepositChooser({
  amount,
  setDepositAmount,
  isRunning,
}: {
  amount: number;
  setDepositAmount: (amount: number) => void;
  isRunning: boolean;
}) {
  return (
    <div className="mt-4 border-t border-stone-200 pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
        Demo control: deposit evidence
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {BONUS_DEPOSIT_OPTIONS.map((option) => {
          const selected = amount === option;
          return (
            <button
              aria-pressed={selected}
              className={`rounded border p-3 text-left transition ${
                selected
                  ? "border-stone-950 bg-stone-950 text-white shadow-sm"
                  : "border-stone-200 bg-white text-stone-700 hover:border-stone-400 disabled:cursor-wait disabled:opacity-60"
              }`}
              disabled={isRunning}
              key={option}
              onClick={() => setDepositAmount(option)}
              type="button"
            >
              <span className="block font-mono text-lg font-semibold">{money(option)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ComplaintStage({
  playerCase,
  selectedPreset,
  setPreset,
  randomize,
  setDepositAmount,
  error,
  runAgent,
  isRunning,
  runElapsedSeconds,
}: {
  playerCase: PlayerCase | null;
  selectedPreset: SelectedPresetKey;
  setPreset: (key: PresetKey) => void;
  randomize: () => void;
  setDepositAmount: (amount: number) => void;
  error: string | null;
  runAgent: () => void;
  isRunning: boolean;
  runElapsedSeconds: number;
}) {
  const selectedCopy = selectedPreset ? selectedPlayerCopy(selectedPreset) : null;

  return (
    <Panel title="Who is the player?" eyebrow="Stage 01" icon={<UsersRound size={18} />}>
      <div className="space-y-5">
        <div>
          <StoryLabel
            number="01"
            question="Choose the player type"
            detail="Unselected players stay anonymous until selected."
          />
          <PlayerChooser
            selectedPreset={selectedPreset}
            setPreset={setPreset}
            randomize={randomize}
            isRunning={isRunning}
          />
        </div>

        {error ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {playerCase && selectedPreset && selectedCopy ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-5">
              <StoryLabel
                number="02"
                question="What bonus are they missing?"
                detail={selectedIntent(selectedPreset)}
              />
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded-lg border border-stone-200 bg-white p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                    Player
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-stone-950">{selectedCopy.label}</h3>
                  <p className="mt-2 text-sm leading-6 text-stone-600">{selectedCopy.detail}</p>
                  <div className="mt-4 grid gap-2 border-t border-stone-200 pt-4 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-stone-500">Player ID</span>
                      <span className="font-mono font-semibold">{playerCase.playerId}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-stone-500">Operator</span>
                      <span className="font-semibold">{playerCase.operator.operatorName}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-stone-500">Complaint ID</span>
                      <span className="font-mono font-semibold">{playerCase.support.complaintId}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                    Missing bonus complaint
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold">{playerCase.campaign.campaignName}</h3>
                  <p className="mt-2 text-sm leading-6">
                    Player says the bonus was not credited.
                  </p>
                  <div className="mt-4 rounded border border-emerald-200 bg-white/70 p-3 text-sm">
                    <p className="font-semibold text-emerald-950">Attached deposit evidence</p>
                    <div className="mt-3 grid gap-2">
                      <div className="flex justify-between gap-3">
                        <span className="text-emerald-800/80">Deposit</span>
                        <span className="font-mono font-semibold">{money(playerCase.payments.depositAmount, playerCase.payments.depositCurrency)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-emerald-800/80">Bonus code</span>
                        <span className="font-mono font-semibold">{playerCase.campaign.playerEnteredBonusCode ?? "missing"}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-emerald-800/80">Campaign</span>
                        <span className="font-mono font-semibold">{playerCase.campaign.campaignId}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-emerald-800/80">Timestamp</span>
                        <span className="font-semibold">{shortDateTime(playerCase.payments.depositTimestamp)}</span>
                      </div>
                    </div>
                  </div>
                  <DepositChooser
                    amount={playerCase.payments.depositAmount}
                    setDepositAmount={setDepositAmount}
                    isRunning={isRunning}
                  />
                </div>
              </div>
            </div>
            <div className="flex min-h-full flex-col justify-end rounded-lg border border-stone-200 bg-white p-5">
              <button
                className="inline-flex min-h-14 items-center justify-center gap-3 rounded bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-wait disabled:bg-emerald-700/70"
                disabled={isRunning}
                onClick={runAgent}
                type="button"
              >
                {isRunning ? (
                  <>
                    <LoaderCircle className="animate-spin" size={18} />
                    Waiting on OpenAI · {runElapsedSeconds}s
                  </>
                ) : (
                  <>
                    <Play size={18} />
                    Resolve missing bonus
                  </>
                )}
              </button>
              {isRunning ? (
                <p className="mt-3 text-xs leading-5 text-stone-500">
                  Live LangChain/OpenAI request in progress. The app will show the provider result or exact provider error.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-6 text-center">
            <UsersRound className="mx-auto text-stone-400" size={28} />
            <p className="mt-3 text-sm font-semibold text-stone-950">
              Select a player to reveal the missing-bonus complaint.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function SourceCard({
  index,
  label,
  icon,
  rows,
  tone = "neutral",
}: {
  index: number;
  label: string;
  icon: React.ReactNode;
  rows: Array<[string, string]>;
  tone?: keyof typeof sourceToneStyles;
}) {
  return (
    <div className={`rounded-lg border p-4 ${sourceToneStyles[tone]}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-current/15 bg-white/60 text-stone-700">
          {icon}
        </span>
        <div>
          <p className="font-mono text-xs font-semibold text-stone-500">{String(index).padStart(2, "0")}. Source</p>
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-stone-700">{label}</h3>
        </div>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        {rows.map(([key, value]) => (
          <div className="grid grid-cols-[140px_1fr] gap-3" key={key}>
            <dt className="text-stone-500">{key}</dt>
            <dd className="min-w-0 font-medium text-stone-950">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SystemsStage({ playerCase }: { playerCase: PlayerCase }) {
  const sources: Array<{
    label: string;
    icon: React.ReactNode;
    tone: keyof typeof sourceToneStyles;
    rows: Array<[string, string]>;
  }> = [
    {
      label: "CRM",
      icon: <CircleDollarSign size={18} />,
      tone: "blue" as const,
      rows: [
        ["Segment", playerCase.crm.playerSegment],
        ["VIP tier", playerCase.crm.vipTier],
        ["Lifetime deposits", money(playerCase.crm.lifetimeDeposits)],
        ["Support tickets", String(playerCase.crm.supportTickets30d)],
      ],
    },
    {
      label: "KYC",
      icon: <ClipboardCheck size={18} />,
      tone: playerCase.kyc.kycStatus === "verified" ? "green" as const : "amber" as const,
      rows: [
        ["Status", playerCase.kyc.kycStatus],
        ["Age claimed", playerCase.kyc.ageClaimed === null ? "missing" : String(playerCase.kyc.ageClaimed)],
        ["ID verified", boolLabel(playerCase.kyc.idVerified)],
        ["Country", playerCase.kyc.country],
      ],
    },
    {
      label: "Campaign",
      icon: <Megaphone size={18} />,
      tone: "amber" as const,
      rows: [
        ["Campaign ID", playerCase.campaign.campaignId],
        ["Code", playerCase.campaign.bonusCode],
        ["Min deposit", money(playerCase.operator.policy.minimumDeposit)],
        ["Grace period", `${playerCase.operator.policy.expiryGraceHours}h`],
      ],
    },
    {
      label: "Payments",
      icon: <CircleDollarSign size={18} />,
      tone: "green" as const,
      rows: [
        ["Deposit", money(playerCase.payments.depositAmount, playerCase.payments.depositCurrency)],
        ["Timestamp", shortDateTime(playerCase.payments.depositTimestamp)],
        ["Chargebacks", String(playerCase.payments.chargebacks)],
        ["Failed deposits", String(playerCase.payments.failedDeposits30d)],
      ],
    },
    {
      label: "Bonus Ledger",
      icon: <Gift size={18} />,
      tone: playerCase.bonusLedger.priorClaimStatus === "none" ? "green" as const : "amber" as const,
      rows: [
        ["Claim status", playerCase.bonusLedger.priorClaimStatus],
        ["Credited at", playerCase.bonusLedger.creditedAt ?? "not credited"],
        ["Wagering", playerCase.bonusLedger.wageringStatus],
        ["Progress", `${playerCase.bonusLedger.wageringProgressPercent}%`],
      ],
    },
    {
      label: "Fraud / Risk",
      icon: <ShieldAlert size={18} />,
      tone: playerCase.risk.vpnDetected || playerCase.risk.countryMismatch ? "red" as const : "neutral" as const,
      rows: [
        ["VPN detected", boolLabel(playerCase.risk.vpnDetected)],
        ["IP country", playerCase.risk.ipCountry],
        ["Device changed", boolLabel(playerCase.risk.deviceChanged)],
        ["Duplicate account", boolLabel(playerCase.risk.duplicateAccountSuspected)],
      ],
    },
    {
      label: "Player Safety",
      icon: <Activity size={18} />,
      tone: playerCase.responsibleGaming.depositVelocity === "high" ? "red" as const : "neutral" as const,
      rows: [
        ["Deposit velocity", playerCase.responsibleGaming.depositVelocity],
        ["Night sessions", String(playerCase.responsibleGaming.nightSessions7d)],
        ["Loss increase", boolLabel(playerCase.responsibleGaming.lossIncrease30d)],
        ["Self exclusion", boolLabel(playerCase.responsibleGaming.selfExclusionHistory)],
      ],
    },
  ];

  return (
    <Panel title="What do we already know from our systems?" eyebrow="Stage 02" icon={<Database size={18} />}>
      <div className="grid gap-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-800">
            Signal Layer input
          </p>
          <h3 className="mt-1 text-2xl font-semibold">One missing-bonus case payload</h3>
          <p className="mt-2 text-sm leading-6">
            Campaign, deposit, CRM, KYC, risk, player-safety, and bonus-ledger data join before deterministic scoring.
          </p>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {sources.map((source, index) => (
            <SourceCard
              icon={source.icon}
              index={index + 1}
              key={source.label}
              label={source.label}
              rows={source.rows}
              tone={source.tone}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function SignalStage({ signals }: { signals: Signal[] }) {
  const decisionSignals = getDecisionSignals(signals);
  const supportingSignals = getSourceSignals(signals);
  const bonusEligibility = getSignal(decisionSignals, "Bonus Eligibility Signal");

  return (
    <div className="min-w-0 space-y-4">
      <Panel title="What Signals does this give us?" eyebrow="Stage 03" icon={<Gauge size={18} />}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-lg border border-stone-200 bg-white p-5">
            <p className="text-sm leading-6 text-stone-700">
              Signals are usually business concepts originating from regulatory, operational, financial, compliance, or risk requirements.
            </p>
            <p className="mt-4 text-sm leading-6 text-stone-700">
              In a mature organisation, signals are rarely invented by engineers. The PM turns those concepts into governed signals the agent can consume.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {signalBusinessDomains.map((domain) => (
                <div
                  className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-900"
                  key={domain}
                >
                  {domain}
                </div>
              ))}
            </div>
          </div>
          <div className={`rounded-lg border p-5 ${signalToneStyles[getSignalTone(bonusEligibility)]}`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
              Primary governed signal
            </p>
            <h3 className="mt-2 text-2xl font-semibold">{bonusEligibility.name}</h3>
            <p className="mt-2 font-mono text-sm font-semibold">{bonusEligibility.outcomeCode}</p>
            <p className="mt-3 text-sm leading-6 opacity-85">{bonusEligibility.explanation.join(" ")}</p>
          </div>
        </div>
      </Panel>
      <Panel title="Supporting deterministic checks" eyebrow="Internal inputs" icon={<Sparkles size={18} />}>
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-5">
          <p className="text-sm leading-6 text-stone-700">
            These supporting checks remain deterministic and auditable, but they are internal inputs to the primary agent-facing signal rather than peer outputs passed to the agent.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {supportingSignals.map((signal) => (
              <span
                className="rounded border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700"
                key={signal.name}
              >
                {signal.name}
              </span>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function AgentConsumerMap({ signals }: { signals: Signal[] }) {
  const consumers = getAgentSignalConsumers(signals);

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
        LangChain AI Agent consumers
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {consumers.map((consumer) => (
          <div className="rounded border border-stone-200 bg-white p-4" key={consumer.agent}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-stone-200 bg-stone-50 text-stone-700">
                <UserRound size={18} />
              </span>
              <p className="min-w-0 text-sm font-semibold text-stone-950">
                {consumer.agent}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {consumer.signals.map((signal) => (
                <span
                  className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-[11px] font-medium leading-4 text-stone-700"
                  key={signal}
                >
                  {signal}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentStage({
  signals,
  isRunning,
  runElapsedSeconds,
  error,
}: {
  signals: Signal[];
  isRunning: boolean;
  runElapsedSeconds: number;
  error: string | null;
}) {
  const activeRunningStep = Math.min(
    langChainRuntimeSteps.length - 1,
    Math.floor(runElapsedSeconds / 4),
  );

  return (
    <Panel
      title="Which LangChain AI agents can use these signals?"
      eyebrow="Stage 04"
      icon={<Activity size={18} />}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <AgentConsumerMap signals={signals} />
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            LangChain boundary
          </p>
          <p className="mt-3 text-sm font-semibold text-stone-950">
            LangChain orchestrates the model/tool loop.
          </p>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            It does not invent eligibility, alter the signal, or grant bonuses outside server guardrails. It consumes the signal, chooses bounded tools, writes player messages, and summarizes escalations.
          </p>
        </div>
      </div>

      {isRunning ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                LangChain + OpenAI
              </p>
              <h3 className="mt-1 text-2xl font-semibold text-emerald-950">
                Waiting on live AI to choose bounded tools
              </h3>
              <p className="mt-2 text-sm leading-6 text-emerald-800">
                Signals are already deterministic. This wait is only the LangChain/OpenAI model/tool loop.
              </p>
            </div>
            <span className="font-mono text-sm font-semibold text-emerald-800">
              {runElapsedSeconds}s
            </span>
          </div>
          <ol className="grid gap-2 md:grid-cols-4">
            {langChainRuntimeSteps.map((step, index) => (
              <li
                className={`flex min-h-24 flex-col justify-between rounded border p-3 text-sm ${
                  index <= activeRunningStep
                    ? "border-emerald-300 bg-white text-emerald-950"
                    : "border-emerald-100 bg-emerald-100/50 text-emerald-700"
                }`}
                key={step.label}
              >
                <span className="flex items-center gap-2">
                  {index < activeRunningStep ? (
                    <CheckCircle2 className="shrink-0" size={15} />
                  ) : index === activeRunningStep ? (
                    <LoaderCircle className="shrink-0 animate-spin" size={15} />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-current/40" />
                  )}
                  <span className="font-medium">{step.label}</span>
                </span>
                <span className="mt-3 text-xs leading-5 opacity-75">{step.detail}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
          <p className="font-semibold">LangChain/OpenAI run stopped before a decision.</p>
          <p className="mt-2">
            The live provider request failed, so no AI decision or tool selection was written.
          </p>
          <p className="mt-2 font-mono text-xs leading-5">{error}</p>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
          Agent execution appears here after the missing-bonus complaint is submitted.
        </div>
      )}
    </Panel>
  );
}

function ListBlock({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{title}</p>
      <ul className="space-y-2 text-sm text-stone-700">
        {(items.length ? items : [empty]).map((item) => (
          <li className="flex gap-2" key={item}>
            <ChevronsRight className="mt-0.5 shrink-0 text-stone-400" size={14} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DecisionPanel({ result }: { result: AgentRunResult | null }) {
  if (!result) {
    return (
      <Panel title="What action is safe?" eyebrow="Stage 05" icon={<ClipboardCheck size={18} />}>
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-5 text-sm leading-6 text-stone-600">
          Run the agent to convert the governed Bonus Eligibility Signal into bounded actions.
        </div>
      </Panel>
    );
  }

  const { decision } = result;
  const statusTone =
    decision.status === "bonus_granted"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : decision.status === "denied"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-red-200 bg-red-50 text-red-950";

  return (
    <Panel title="What action is safe?" eyebrow="Stage 05" icon={<ClipboardCheck size={18} />}>
      <div className={`rounded-lg border p-5 ${statusTone}`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
          Decision
        </p>
        <h3 className="mt-2 text-4xl font-semibold">
          {statusLabels[decision.status]}
        </h3>
        <p className="mt-3 max-w-4xl whitespace-pre-line text-base font-medium leading-7">
          {decision.primaryReason}
        </p>
        <p className="mt-4 text-xs opacity-70">
          {result.executionMode === "langchain_openai" ? "LangChain + OpenAI" : "Deterministic offline"}
          {result.model ? ` | ${result.model}` : ""}
        </p>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <ListBlock title="Actions taken" items={decision.actionsTaken} empty="No action executed" />
        <ListBlock title="Blocked actions" items={decision.blockedActions} empty="No blocked action" />
      </div>
    </Panel>
  );
}

function MetricsPanel({ result }: { result: AgentRunResult }) {
  const metrics = [
    ["Deflected", metricLabel(result.metrics.deflected)],
    ["Reopened", metricLabel(result.metrics.reopened)],
    ["Time to resolve", `${result.metrics.timeToResolveMs}ms`],
    ["Signal outcome", result.metrics.signalOutcomeCode],
    ["Human escalated", metricLabel(result.metrics.humanEscalated)],
    ["Bonus granted", metricLabel(result.metrics.bonusGranted)],
    ["Player message", metricLabel(result.metrics.playerMessageSent)],
  ];

  return (
    <Panel title="Outcome Metrics" eyebrow="Operational performance" icon={<BadgeCheck size={18} />}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-4" key={label}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-500">{label}</p>
            <p className="mt-2 min-w-0 break-words font-mono text-lg font-semibold text-stone-950">{value}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ToolCallsPanel({ toolCalls }: { toolCalls: ToolCallLog[] }) {
  return (
    <Panel title="Tool Calls" eyebrow="OpenAI-style function log" icon={<Braces size={18} />}>
      {toolCalls.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
          Tool calls appear here after an agent run.
        </p>
      ) : (
        <div className="space-y-2">
          {toolCalls.map((call) => (
            <details className="rounded-lg border border-stone-200 bg-white p-3" key={call.id}>
              <summary className="flex cursor-pointer list-none items-center gap-3">
                <CheckCircle2 className="shrink-0 text-emerald-600" size={16} />
                <span className="min-w-0 truncate font-mono text-xs text-stone-900">
                  {call.toolName}()
                </span>
              </summary>
              <pre className="mt-3 max-h-48 overflow-auto rounded bg-stone-950 p-3 text-xs leading-5 text-stone-100">
                {JSON.stringify({ arguments: call.arguments, result: call.result }, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      )}
    </Panel>
  );
}

function TraceLogPanel({ traceEvents }: { traceEvents: TraceEvent[] }) {
  return (
    <Panel title="Trace Log" eyebrow="Audit trail" icon={<History size={18} />}>
      {traceEvents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
          The trace will show player selection, signal calculation, tool calls, decision, and metrics.
        </p>
      ) : (
        <ol className="space-y-3">
          {traceEvents.map((event) => (
            <li className="grid grid-cols-[72px_1fr] gap-3 text-sm" key={event.id}>
              <time className="font-mono text-xs text-stone-500">{shortTime(event.timestamp)}</time>
              <div className="border-l border-stone-200 pl-3">
                <p className="font-medium text-stone-900">{event.title}</p>
                <p className="text-xs leading-5 text-stone-600">{event.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function MemoryPanel({ memory }: { memory: AgentMemory | null }) {
  return (
    <Panel title="Player Memory" eyebrow="Run context" icon={<History size={18} />}>
      {!memory ? (
        <p className="text-sm leading-6 text-stone-600">
          Memory starts empty. Re-running the same player type adds previous decisions and actions.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <ListBlock title="Decisions" items={memory.previousDecisions} empty="None" />
          <ListBlock title="Actions" items={memory.previousActions.slice(-5)} empty="None" />
          <ListBlock title="Notes" items={memory.notes.slice(-3)} empty="None" />
        </div>
      )}
    </Panel>
  );
}

function AuditStage({
  result,
  memory,
}: {
  result: AgentRunResult;
  memory: AgentMemory | null;
}) {
  return (
    <Panel title="Can we prove the result and measure performance?" eyebrow="Stage 06" icon={<FileText size={18} />}>
      <div className="min-w-0 space-y-4">
        <MetricsPanel result={result} />
        <ToolCallsPanel toolCalls={result.toolCalls} />
        <TraceLogPanel traceEvents={result.trace} />
        <MemoryPanel memory={memory} />
      </div>
    </Panel>
  );
}

function StageTimeline({
  playerCase,
  selectedPreset,
  setPreset,
  randomize,
  setDepositAmount,
  hasSelection,
  signals,
  result,
  memory,
  error,
  isRunning,
  runAgent,
  runElapsedSeconds,
}: {
  playerCase: PlayerCase | null;
  selectedPreset: SelectedPresetKey;
  setPreset: (key: PresetKey) => void;
  randomize: () => void;
  setDepositAmount: (amount: number) => void;
  hasSelection: boolean;
  signals: Signal[];
  result: AgentRunResult | null;
  memory: AgentMemory | null;
  error: string | null;
  isRunning: boolean;
  runAgent: () => void;
  runElapsedSeconds: number;
}) {
  return (
    <div className="space-y-6">
      <section className="scroll-mt-28" id="stage-complaint">
        <ComplaintStage
          playerCase={playerCase}
          selectedPreset={selectedPreset}
          setPreset={setPreset}
          randomize={randomize}
          setDepositAmount={setDepositAmount}
          error={error}
          runAgent={runAgent}
          isRunning={isRunning}
          runElapsedSeconds={runElapsedSeconds}
        />
      </section>

      {hasSelection && playerCase ? (
        <section className="scroll-mt-28" id="stage-systems">
          <SystemsStage playerCase={playerCase} />
        </section>
      ) : null}

      {hasSelection ? (
        <section className="scroll-mt-28" id="stage-signals">
          <SignalStage signals={signals} />
        </section>
      ) : null}

      {hasSelection ? (
        <section className="scroll-mt-28" id="stage-agent">
          <AgentStage
            signals={signals}
            isRunning={isRunning}
            runElapsedSeconds={runElapsedSeconds}
            error={error}
          />
        </section>
      ) : null}

      {result ? (
        <>
          <section className="scroll-mt-28" id="stage-decision">
            <DecisionPanel result={result} />
          </section>
          <section className="scroll-mt-28" id="stage-audit">
            <AuditStage result={result} memory={memory} />
          </section>
        </>
      ) : null}
    </div>
  );
}

export function SignalOpsPresentation() {
  const [selectedPreset, setSelectedPreset] = useState<SelectedPresetKey>(null);
  const [playerCase, setPlayerCase] = useState<PlayerCase | null>(null);
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [memory, setMemory] = useState<AgentMemory | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runElapsedSeconds, setRunElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const hasSelection = playerCase !== null && selectedPreset !== null;
  const signals = useMemo(() => (playerCase ? calculateSignals(playerCase) : []), [playerCase]);

  useEffect(() => {
    if (!isRunning) return;

    const intervalId = window.setInterval(() => {
      setRunElapsedSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) return;

    window.requestAnimationFrame(() => {
      document.getElementById("stage-agent")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [isRunning]);

  function setPreset(key: PresetKey) {
    setSelectedPreset(key);
    setPlayerCase(getPresetCase(key));
    setResult(null);
    setMemory(null);
    setError(null);
  }

  function randomize() {
    setSelectedPreset("random");
    setPlayerCase(generateRandomCase());
    setResult(null);
    setMemory(null);
    setError(null);
  }

  function updateDepositAmount(amount: number) {
    setPlayerCase((currentCase) => currentCase ? withBonusDepositAmount(currentCase, amount) : currentCase);
    setResult(null);
    setMemory(null);
    setError(null);
  }

  async function runAgent() {
    if (!playerCase) {
      return;
    }

    setRunElapsedSeconds(0);
    setIsRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case: cloneCase(playerCase),
          signals: getDecisionSignals(signals),
          memory,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as AgentApiError | null;
        const detail = payload?.detail ? ` ${payload.detail}` : "";
        const model = payload?.model ? ` Model: ${payload.model}.` : "";
        const hint = payload?.offlineModeHint ? ` ${payload.offlineModeHint}` : "";
        throw new Error(`${payload?.error ?? `Agent API returned ${response.status}`}.${model}${detail}${hint}`);
      }

      const nextResult = (await response.json()) as AgentRunResult;
      setResult(nextResult);
      setMemory(nextResult.memory);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Agent run failed");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-100 text-stone-950">
      <FlowHeader />

      <div className="px-5 py-5 lg:px-8">
        <StageTimeline
          playerCase={playerCase}
          selectedPreset={selectedPreset}
          setPreset={setPreset}
          randomize={randomize}
          setDepositAmount={updateDepositAmount}
          hasSelection={hasSelection}
          signals={signals}
          result={result}
          memory={memory}
          error={error}
          isRunning={isRunning}
          runAgent={runAgent}
          runElapsedSeconds={runElapsedSeconds}
        />
      </div>
    </main>
  );
}
