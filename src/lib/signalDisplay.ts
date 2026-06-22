import type { Signal, SignalSeverity } from "./types";

export type SignalTone = "good" | "info" | "warning" | "danger" | "critical";

const positiveSignals = new Set(["Identity Confidence", "Bonus Eligibility Signal"]);
const commercialSignals = new Set(["Player Value"]);

function positiveTone(severity: SignalSeverity): SignalTone {
  if (severity === "high") return "good";
  if (severity === "medium") return "warning";
  if (severity === "critical") return "critical";
  return "danger";
}

function riskTone(severity: SignalSeverity): SignalTone {
  if (severity === "low") return "good";
  if (severity === "medium") return "warning";
  if (severity === "high") return "danger";
  return "critical";
}

export function getSignalTone(signal: Pick<Signal, "name" | "severity">): SignalTone {
  if (signal.name === "Bonus Eligibility Signal" && signal.severity === "critical") {
    return "critical";
  }
  if (signal.name === "Bonus Eligibility Signal" && signal.severity === "medium") {
    return "warning";
  }
  if (commercialSignals.has(signal.name)) return "info";
  if (positiveSignals.has(signal.name)) return positiveTone(signal.severity);
  return riskTone(signal.severity);
}
