import { getSourceSignals } from "./signals";
import type { Signal } from "./types";

export const primarySignalConsumers = [
  "Bonus Resolution Agent",
  "Support Agent",
  "Retention Agent",
  "Fraud Agent",
] as const;

export type PrimarySignalConsumer = (typeof primarySignalConsumers)[number];

export type AgentSignalConsumer = {
  agent: PrimarySignalConsumer;
  signals: string[];
};

export function getAgentSignalConsumers(signals: Signal[]): AgentSignalConsumer[] {
  const sourceSignals = getSourceSignals(signals);

  return primarySignalConsumers.map((agent) => ({
    agent,
    signals: sourceSignals
      .filter((signal) => signal.usedBy.includes(agent))
      .map((signal) => signal.name),
  }));
}
