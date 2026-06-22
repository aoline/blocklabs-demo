# BlockLabs Bonus Eligibility Agent Studio

Working presentation demo for a job interview.

The app presents the project like a slide deck, but the core proof is live:
select a missing-bonus player type, calculate deterministic signals, run the
Bonus Resolution Agent, and inspect the decision, tool calls, metrics, memory,
and trace log.

## What It Demonstrates

- governed Signal Layer design
- deterministic TypeScript bonus eligibility logic
- operator policy profiles for white-label governance
- LangChain.js agent orchestration
- OpenAI tool/function calling through ChatOpenAI
- bounded tool-call actions
- guardrails where player value cannot override risk or player-safety controls
- deflection and re-open metrics for operational performance
- full decision traceability for management and compliance

## Run Locally

Create a local environment file:

```bash
cp .env.example .env.local
```

Then set your real key in `.env.local`:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.5
```

Run the app:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Interview Flow

1. Choose a player type such as `Eligible Verified Player`.
2. Explain the missing-bonus complaint.
3. Show the source systems: CRM, KYC, campaign, payments, bonus ledger, fraud/risk, and player safety.
4. Show the deterministic `Bonus Eligibility Signal`.
5. Explain that LangChain consumes the signal and chooses bounded tools.
6. Run the agent.
7. Walk through the final decision, tool calls, trace log, deflection, and re-open metrics.

## Engineering Direction

See [docs/engineering-direction.md](docs/engineering-direction.md).

The primary runtime uses LangChain.js `createAgent`, `ChatOpenAI`, and the
project-specified bonus resolution tools. Live runs either complete with
LangChain/OpenAI tool calls or expose the provider/configuration error.
Deterministic simulation is available only when explicitly requested through the
CLI `--offline` mode.

## CLI Proof Layer

The CLI proves the system is real underneath the presentation.

```bash
npm run signalops:studio
npm run signalops -- demo eligible --offline
npm run signalops -- generate blocked
npm run signalops -- signals
npm run signalops -- run
npm run signalops -- trace
npm run signalops -- replay
npm run signalops -- metrics
npm run signalops -- explain "Bonus Eligibility Signal"
```

`signalops:studio` opens an interactive keyboard menu. Use Up/Down and Enter to
navigate; number keys still work as shortcuts. It starts in deterministic
offline mode so the step-by-step walkthrough works even when the live OpenAI key
has quota or auth problems. Toggle live mode inside the menu when the key is
ready.

Live mode uses `.env.local`:

```bash
npm run signalops -- run --model gpt-5.5
```

If OpenAI returns an error, the CLI saves a failed run and exits non-zero. It
does not silently replace the agent with deterministic output. Local run state
is stored under `.signalops/`, which is ignored by git.

## Verification

```bash
npm run lint
npm run build
```
