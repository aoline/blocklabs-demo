import { NextResponse } from "next/server";
import { runBonusResolutionAgent } from "@/lib/agent";
import { runLangChainBonusResolutionAgent } from "@/lib/langchainAgent";
import type { AgentMemory, PlayerCase, Signal } from "@/lib/types";

type AgentRequest = {
  case: PlayerCase;
  signals?: Signal[];
  memory?: AgentMemory | null;
  mode?: "live" | "offline";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AgentRequest;

    if (!body.case?.playerId) {
      return NextResponse.json(
        { error: "Missing player-type payload." },
        { status: 400 },
      );
    }

    if (body.mode === "offline") {
      const offlineResult = runBonusResolutionAgent({
        case: body.case,
        signals: body.signals,
        memory: body.memory ?? null,
      });
      offlineResult.trace.unshift({
        id: `TRACE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        timestamp: new Date().toISOString(),
        type: "error",
        title: "Running deterministic offline mode",
        detail: "LangChain/OpenAI tool calling was skipped because offline mode was explicitly requested.",
      });
      return NextResponse.json(offlineResult);
    }

    if (process.env.OPENAI_API_KEY) {
      try {
        return NextResponse.json(
          await runLangChainBonusResolutionAgent({
            case: body.case,
            signals: body.signals,
            memory: body.memory ?? null,
          }),
        );
      } catch (error) {
        return NextResponse.json(
          {
            error: "LangChain/OpenAI run failed.",
            detail: error instanceof Error ? error.message : "Unknown LangChain error",
            provider: "openai",
            model: process.env.OPENAI_MODEL || "gpt-5.5",
            offlineModeAvailable: true,
            offlineModeHint: "Use an explicit offline mode to run the deterministic simulation.",
          },
          { status: 502 },
        );
      }
    }

    return NextResponse.json(
      {
        error: "OPENAI_API_KEY is not configured.",
        detail: "Live LangChain/OpenAI execution cannot start without an OpenAI API key. No deterministic simulation was run.",
        provider: "openai",
        model: process.env.OPENAI_MODEL || "gpt-5.5",
        offlineModeAvailable: true,
        offlineModeHint: "Use an explicit offline mode to run the deterministic simulation.",
      },
      { status: 503 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Agent run failed.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
