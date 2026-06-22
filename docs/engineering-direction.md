# Engineering Direction

## Goal

Build the presentation as a working demo, not a static slide deck.

The project now demonstrates **User-Facing Autonomous Resolution** for a common
high-friction support problem: a player says a campaign bonus was not credited.

The first screen should let management understand the project quickly:

- a missing-bonus complaint comes in
- existing systems provide the case context
- deterministic TypeScript produces a governed `Bonus Eligibility Signal`
- LangChain/OpenAI consumes that signal and chooses bounded tools
- the run records decision, trace, deflection, and re-open metrics

## Core Principle

The AI must not decide bonus eligibility.

Eligibility is a governed business fact. The Signal Layer owns:

- signal name
- signal score
- signal severity
- outcome code
- factors
- explanation
- version
- owner
- consumers

LangChain/OpenAI may:

- consume the governed signal
- interpret what the outcome means for the player interaction
- choose approved tools
- draft the player-facing response
- summarize escalation context

LangChain/OpenAI must never:

- create signal scores
- change eligibility
- override operator policy
- grant a bonus outside server guardrails

```text
Raw source data
-> deterministic signal engine
-> Bonus Eligibility Signal
-> LangChain agent interpretation
-> bounded tool calls
-> decision, trace, metrics
```

## Signal Layer

The demo keeps five supporting governed signals:

- Identity Confidence
- Underage Risk
- Fraud Risk
- Responsible Gaming Risk
- Player Value

The primary governed signal is:

- Bonus Eligibility Signal

Outcome codes:

- `BONUS_CREDIT_VERIFIED`
- `BONUS_CREDIT_DENIED_EXPIRED`
- `BONUS_CREDIT_DENIED_ALREADY_CLAIMED`
- `BONUS_CREDIT_DENIED_DEPOSIT_MISMATCH`
- `BONUS_CREDIT_DENIED_WAGERING_INCOMPLETE`
- `BONUS_CREDIT_BLOCKED_RISK`
- `BONUS_CREDIT_BLOCKED_RG`
- `BONUS_CREDIT_UNCERTAIN`

The signal is deterministic. Given the same player, campaign, policy, deposit,
ledger, KYC, risk, and player-safety inputs, the same outcome code must be
produced every time.

## White-Label Governance

The demo includes an operator policy fixture so the rules are not treated as
CLI-owned logic.

In production, these parameters would come from governed operator configuration:

- eligible player segments
- minimum deposit
- accepted currencies
- campaign window
- one-claim rule
- fraud and responsible-gaming blocker thresholds
- expiry grace period
- re-open tracking window

The engine executes the governed policy. Operators configure the parameters for
their own brands.

## Agent Layer

The Bonus Resolution Agent receives the `Bonus Eligibility Signal` and can call
only approved tools:

- `getBonusEligibilitySignal`
- `grantBonus`
- `sendPlayerMessage`
- `showActivePromotions`
- `createHumanEscalation`
- `createSupportResolutionNote`
- `pausePromotions`

Tool mapping:

- verified -> grant bonus, message player, create resolution note
- deterministic denial -> message player, show active promotions, create note
- blocked responsible-gaming -> pause promotions, escalate, message player, create note
- blocked risk or uncertain -> escalate, message player, create note

The `grantBonus` tool has a server-side guardrail. It succeeds only when the
deterministic signal outcome is `BONUS_CREDIT_VERIFIED`.

## Metrics

Every completed run records:

- `deflected`
- `reopened`
- `timeToResolveMs`
- `resolutionOutcome`
- `signalOutcomeCode`
- `humanEscalated`
- `bonusGranted`
- `playerMessageSent`

The CLI `metrics` view aggregates:

- deflection rate
- re-open rate
- human escalations
- breakdown by outcome code
- breakdown by operator
- breakdown by campaign

These metrics answer whether the agent is truly reducing support load without
being too aggressive. A high deflection rate with a high re-open rate means the
agent is resolving too much or missing a required signal.

## Runtime Modes

Primary mode:

- LangChain.js agent loop
- ChatOpenAI model
- OpenAI tool/function calling
- seven typed bonus-resolution tools

Offline simulation mode:

- deterministic local runner
- used only when explicitly requested from the CLI with `--offline`
- keeps the system demonstrable without network access
- never pretends to be a live OpenAI/LangChain run

Live failures are first-class results. If OpenAI returns a quota, auth, model, or
network error, the API and CLI expose that error instead of silently producing a
deterministic decision.

## UI Story

Use a top-down reveal:

1. Who is the player?
2. What bonus are they missing?
3. What do we already know from our systems?
4. What Signals does this give us?
5. Which LangChain AI agents can use these signals?
6. What action is safe?
7. Can we prove the result and measure performance?

Do not show data for unselected player types. The selected player is the only
one whose persona, complaint, source-system data, signals, and outcome appear.

The UI should communicate the product story without presenter-cue panels:
headers, stage labels, source cards, signal cards, tool calls, trace output, and
metrics are the explanation.

## CLI Proof Layer

The CLI is the engineering proof layer beneath the presentation:

- generated or preset player types are persisted locally
- deterministic signals can be recalculated outside the UI
- live LangChain/OpenAI runs are replayable by run ID
- OpenAI failures are visible and saved as failed runs
- offline deterministic runs are available only by explicit command
- aggregate deflection and re-open metrics can be inspected

The interactive interview path is:

```bash
npm run signalops:studio
```

The direct command-line interview path is:

```bash
npm run signalops -- demo eligible --offline
```

The live proof path is:

```bash
npm run signalops -- generate eligible
npm run signalops -- signals
npm run signalops -- run --model gpt-5.5
npm run signalops -- trace
npm run signalops -- metrics
```

## Non-Goals

- no real gambling operations
- no real payment, KYC, campaign, CRM, or casino integrations
- no production auth or database
- no dependency on a live LLM when the explicit offline CLI mode is used
