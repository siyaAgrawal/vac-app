# VAC Universal Communication OS Redesign

## Purpose

This document replaces the implicit product definition currently encoded across the repository.

VAC should no longer be treated as:

- a WhatsApp analytics workspace
- a collection of message utilities
- a dashboard with AI helpers attached

VAC should be treated as:

**A universal communication intelligence layer that sits between the user and every text conversation.**

The keyboard, composer, and send decision are the center of the product.

---

## 1. Current-State Audit

### 1.1 Product Model Problems

The current repository still implements VAC as a collection of separate tools:

- `src/pages/Dashboard.tsx`
- `src/pages/ToneLab.tsx`
- `src/pages/Psychology.tsx`
- `src/pages/Schedule.tsx`
- `src/pages/Commitments.tsx`
- `src/pages/Chat.tsx`
- `src/pages/LiveChat.tsx`
- `src/pages/AutoReply.tsx`
- `src/pages/KeyboardCompanion.tsx`

Why this exists:

- the app evolved feature-by-feature
- each insight type became its own page
- routing became the product architecture

Impact:

- users must decide which tool to open before VAC can help
- intelligence is fragmented instead of synthesized
- the UI teaches “feature hunting” instead of “what should I do next?”
- core reply assistance competes with dashboards for attention

Superior architecture:

- one workspace
- one intelligence pipeline
- one composer-centric decision model
- insight modules run in the background and feed the next-message surface

Implementation direction:

- remove feature-first navigation as the core UX
- unify analysis into `Memory -> Context -> Decision -> Communication`
- keep specialized views only as secondary drill-down surfaces

Migration:

1. Freeze new page-level feature additions.
2. Introduce a new universal shell with `Inbox`, `Conversations`, `Actions`, `Memory`, `Assistant`.
3. Reframe current pages as temporary internal views behind the new shell.
4. Move suggestion, timing, commitment, and psychology outputs into conversation and composer surfaces.

### 1.2 WhatsApp-Centric Domain Model

Current files show the product is still built around WhatsApp as the primary entity:

- `src/lib/chatStore.ts`
- `src/lib/whatsappImport.ts`
- `server/parseWhatsAppExport.js`
- `server/whatsapp/*`
- `extension/content.js`

Why this exists:

- imports are based on WhatsApp text exports
- live mode uses `whatsapp-web.js`
- core normalized chat types are named after WhatsApp

Impact:

- platform-specific fields leak into product-wide logic
- “conversation intelligence” is actually “WhatsApp intelligence”
- other connectors would require duplication rather than extension
- naming alone pushes future contributors into the wrong abstraction

Superior architecture:

- all platform integrations become connectors
- every connector emits the same normalized objects:
  - account
  - conversation
  - participant
  - message
  - reaction
  - attachment
  - thread state
  - delivery metadata

Implementation direction:

- create a connector contract in a shared domain package
- move WhatsApp logic under `connectors/whatsapp`
- rename `WhatsAppMessage` to `NormalizedMessage`
- represent imports, web bridges, native SDKs, and extension capture as ingestion adapters

Migration:

1. Add new platform-agnostic types.
2. Make existing WhatsApp import and bridge map into those types.
3. Update frontend state and server APIs to consume normalized conversation entities.
4. Only then add Telegram/iMessage/Slack/etc connectors.

### 1.3 Storage Model Is Not Product-Grade

Current storage is split between browser `localStorage` and ad hoc JSON files:

- `src/lib/chatStore.ts`
- `src/lib/commitments.ts`
- `src/lib/chatHistory.ts`
- `src/lib/toneHistory.ts`
- `server/whatsapp/memory.js`
- `server/keyboard/suggest.js`

Why this exists:

- local iteration speed
- no unified database layer
- frontend and backend each own separate memory

Impact:

- no single source of truth
- no reliable multi-device story
- browser storage quotas silently truncate core data
- imported chats, live memory, keyboard preference memory, and commitments diverge
- encryption and deletion guarantees are weak

Superior architecture:

- a local-first encrypted data layer
- one canonical memory graph
- append-only event log plus materialized views

Recommended model:

- local database:
  - SQLite + SQLCipher or SQLite + file-level encryption initially
- storage layers:
  - `event_log`
  - `entities`
  - `relations`
  - `artifacts`
  - `indexes`
- optional sync layer:
  - encrypted replication of selected records only

Implementation direction:

- replace `localStorage` persistence with repository-backed data services
- move JSON memory files behind a storage interface
- model commitments, relationships, and inferred traits as entities derived from events

Migration:

1. Introduce a storage adapter interface.
2. Build SQLite-backed implementations.
3. Read legacy browser/local JSON data and convert into normalized events.
4. Keep legacy readers only for one migration window, then remove.

### 1.4 Frontend State Is Coupled To Legacy Product Boundaries

Key file:

- `src/context/ChatContext.tsx`

Why this exists:

- one context absorbed chat import, live append, commitment extraction, notifications, and active selection

Impact:

- domain logic lives in UI context instead of services
- hard to scale across desktop, web, iOS, and Android
- impossible to reason about state ownership cleanly

Superior architecture:

- split by domain:
  - `conversationStore`
  - `memoryStore`
  - `actionStore`
  - `assistantStore`
  - `connectorStore`
- UI subscribes to derived selectors, not raw persistence helpers

Implementation direction:

- create application services for ingestion, memory extraction, suggestions, and action tracking
- move extraction and mutation logic out of React context

Migration:

1. Keep `ChatContext` as a compatibility wrapper.
2. Move one concern at a time into domain services.
3. Replace direct localStorage helpers with service calls.

### 1.5 AI Pipeline Is Feature-Siloed

Current files:

- `server/whatsapp/analyzer.js`
- `server/keyboard/suggest.js`
- `src/lib/anthropic.ts`
- `server/openaiExtract.js`
- `server/toneAnalysis.js`

Why this exists:

- each feature independently calls AI for its own output
- heuristics and model prompts evolved separately

Impact:

- inconsistent suggestions across product surfaces
- duplicated reasoning
- duplicated prompt logic across JS and Swift
- hard to explain why a suggestion appeared

Superior architecture:

- one orchestration pipeline:
  1. ingest
  2. enrich
  3. retrieve relevant context
  4. decide action
  5. generate reply variants
  6. log outcome

Modules should become:

- memory extraction
- relationship inference
- commitment detection
- urgency and closure detection
- life-context retrieval
- reply policy engine
- language generation engine

Migration:

1. Introduce a shared `decision engine` service.
2. Make keyboard/live/assistant surfaces call that engine.
3. Keep existing feature endpoints as wrappers around the new engine until removed.

### 1.6 No-Reply Detection Is Underpowered

Current implementation:

- basic closure heuristics in `server/whatsapp/conversationIntelligence.js`
- limited `shouldReply` handling in keyboard/live flows

Impact:

- VAC still defaults toward generating language rather than deciding whether silence is best
- a core product advantage is underdeveloped

Superior architecture:

- a dedicated response policy engine that can output:
  - `reply_now`
  - `reply_later`
  - `no_reply`
  - `ask_clarifying_question`
  - `set_boundary`
  - `defer_with_time`
  - `escalate_to_call`

Migration:

1. Promote closure and loop detection into a first-class service.
2. Require a decision object before any reply generation.
3. Make all UIs display the decision and rationale, not just text variants.

### 1.7 Commitments Are Important But Under-Modeled

Current files:

- `src/lib/commitments.ts`
- `server/fulfillmentCheck.js`
- `src/hooks/useNotifications.ts`

Why this exists:

- commitments were extracted from message text and stored like a task list

Impact:

- no durable link between promise, source message, responsible person, deadline, and outcome
- no support for relationship risk scoring
- overdue tracking is shallow

Superior architecture:

- commitments become graph entities linked to:
  - source message
  - source conversation
  - counterparties
  - deadline
  - supporting evidence
  - fulfillment status
  - impact if missed

Migration:

1. Add `commitment`, `obligation`, `follow_up`, and `open_question` entity types.
2. Store provenance for each extracted commitment.
3. Add resolution events instead of only mutable status.

### 1.8 Privacy Model Is Incomplete

Current privacy issues:

- API keys can be copied into `.env` and `data/keys.json` via `server/keyStore.js`
- message memory is plaintext JSON in `data/whatsapp-memory` and `data/keyboard-memory`
- browser `localStorage` holds sensitive message and commitment data unencrypted

Impact:

- VAC cannot credibly become a life-scale communication layer with plaintext persistence
- deletion/export guarantees are weak
- sync would compound the risk

Superior architecture:

- local-first encrypted storage by default
- selective sync opt-in
- per-data-class retention controls
- explicit deletion and export tooling

Migration:

1. Move secrets to OS secure storage only.
2. Encrypt local databases at rest.
3. Add data retention, export, and delete APIs before broadening connectors.

### 1.9 Platform Strategy Is Fragmented

Current parallel surfaces:

- web app
- Chrome extension
- iOS keyboard
- Android IME
- WhatsApp bridge

Impact:

- logic is duplicated
- UX differs per surface
- feature parity becomes expensive

Superior architecture:

- one shared domain core
- thin platform shells

Recommended split:

- `packages/domain`
- `packages/decision-engine`
- `packages/connectors`
- `packages/storage`
- `apps/web`
- `apps/desktop`
- `apps/ios-keyboard`
- `apps/android-ime`
- `extensions/browser`

### 1.10 UI Pattern Is Calm But Wrongly Structured

Current shell:

- `src/components/Layout.tsx`

Problem:

- navigation is elegant but still teaches the wrong interaction model

Target shell:

- `Inbox`
- `Conversations`
- `Actions`
- `Memory`
- `Assistant`

Rules:

- composer and decision card stay visible whenever possible
- insights appear inline, not in separate “labs”
- the user should not need to know where tone or psychology lives

---

## 2. Target Product Architecture

### 2.1 System Layers

#### Layer 1: Memory Graph

Stores:

- people
- identities across platforms
- conversations
- messages
- commitments
- goals
- projects
- deadlines
- preferences
- relationship events
- inferred traits with confidence and provenance

Core principle:

- nothing important should exist only as a page-local artifact

#### Layer 2: Context Engine

Builds the active working set for any reply decision using:

- current thread
- relevant prior conversations
- relationship history
- pending commitments
- calendar and life constraints
- recent emotional signals
- user goals for this person or project

Output:

- a ranked context pack with provenance and confidence

#### Layer 3: Decision Engine

Produces a structured decision before language generation.

Example output:

```json
{
  "policy": "reply_later",
  "reasoning": [
    "The message is informational and does not require a same-hour response.",
    "The user has three deadlines tomorrow morning.",
    "A quick confirmation now would create a new commitment."
  ],
  "risks": [
    "Waiting more than 24 hours may feel dismissive."
  ],
  "recommended_time_window": "tomorrow 4:00 PM to 6:00 PM",
  "strategy": "acknowledge briefly and defer"
}
```

#### Layer 4: Communication Engine

Generates variants only after the policy is chosen.

Default variants:

- Quick
- Professional
- Warm
- Persuasive
- Boundary-setting

Each variant must expose:

- why this was suggested
- expected outcome
- risk

---

## 3. Target Data Model

### 3.1 Core Entities

- `Account`
- `Connector`
- `Identity`
- `Person`
- `Conversation`
- `ConversationParticipant`
- `Message`
- `Attachment`
- `Reaction`
- `ActionItem`
- `Commitment`
- `OpenLoop`
- `Goal`
- `Project`
- `RelationshipProfile`
- `Inference`
- `Suggestion`
- `Decision`
- `OutcomeEvent`

### 3.2 Graph Edges

- `person -> identity`
- `person -> conversation`
- `message -> conversation`
- `message -> person`
- `message -> commitment`
- `commitment -> project`
- `commitment -> due_date`
- `conversation -> relationship_profile`
- `decision -> context_inputs`
- `suggestion -> decision`
- `outcome_event -> suggestion`

### 3.3 Provenance Rules

Every inference must store:

- source messages
- source conversations
- extraction method
- model or heuristic version
- timestamp
- confidence

---

## 4. Connector Framework

### 4.1 Connector Contract

Every connector must implement:

- `listAccounts()`
- `listConversations(accountId, cursor)`
- `getConversation(conversationId)`
- `listMessages(conversationId, cursor)`
- `streamEvents()`
- `sendMessage(conversationId, content)`
- `resolveParticipants(conversationId)`
- `fetchAttachments(messageId)`
- `capabilities()`

### 4.2 Connector Types

- import connector
- web automation connector
- native SDK connector
- browser-extension connector
- email API connector
- device bridge connector

### 4.3 Near-Term Connector Order

1. WhatsApp import connector
2. WhatsApp live bridge connector
3. Browser universal web connector
4. Email connector
5. Telegram connector
6. Slack connector
7. iMessage/SMS device connector

---

## 5. New UX Model

### 5.1 Primary Navigation

- `Inbox`: what requires thought now
- `Conversations`: relationship-aware thread workspace
- `Actions`: commitments, follow-ups, unresolved questions
- `Memory`: people, goals, relationship graph, knowledge controls
- `Assistant`: global ask-anything interface across all memory

### 5.2 Conversation Workspace

Each conversation should contain:

- thread view
- decision card
- reply timing recommendation
- no-reply recommendation when appropriate
- reply variant rail
- commitment warnings
- relationship context
- linked actions and prior promises

### 5.3 Composer Rules

The composer is the product.

Required behaviors:

- always show decision before draft when useful
- offer multiple reply strategies, not one answer
- explain tradeoffs
- surface commitment and timing conflicts inline
- warn when sending creates new obligations

---

## 6. Repository Reorganization

### 6.1 Proposed Structure

```text
apps/
  web/
  desktop/
  ios-keyboard/
  android-ime/
  browser-extension/

packages/
  domain/
  storage/
  memory-graph/
  context-engine/
  decision-engine/
  communication-engine/
  connectors/
    whatsapp/
    email/
    browser/
  ui/
  security/
```

### 6.2 Mapping From Current Repo

- `src/pages/*` -> split into conversation workspace and supporting views
- `src/lib/chatStore.ts` -> `packages/storage`
- `src/lib/commitments.ts` -> `packages/domain` + `packages/storage`
- `server/whatsapp/*` -> `packages/connectors/whatsapp`
- `server/keyboard/suggest.js` -> `packages/communication-engine`
- `keyboard-ios/*` and `keyboard-android/*` -> thin clients over shared APIs
- `extension/*` -> browser connector client, not a second product

---

## 7. Migration Plan

### Phase 0: Freeze And Document

- stop adding new feature pages
- define normalized entities and connector contracts
- document the target shell and decision engine

### Phase 1: Domain Foundation

- add normalized conversation and person types
- add storage abstraction
- add connector abstraction
- adapt WhatsApp import and live bridge to the new contract

### Phase 2: Memory Graph

- create local encrypted database
- migrate chats, commitments, and memory into canonical entities
- store provenance for inferences

### Phase 3: Decision Engine

- centralize no-reply, delay, de-escalation, follow-up, and reply strategy selection
- make keyboard/live/web all call the same decision service

### Phase 4: New Workspace

- replace the current feature-first navigation
- build `Inbox`, `Conversations`, `Actions`, `Memory`, `Assistant`
- move current pages behind temporary compatibility routes if needed

### Phase 5: Cross-Platform Unification

- move shared logic into packages
- keep thin web, iOS, Android, and browser clients
- standardize telemetry and outcome logging

### Phase 6: Privacy Hardening

- secure secret storage only
- encrypt message memory
- ship export/delete controls
- add selective sync

---

## 8. Immediate Build Priorities

These are the highest-value next implementation steps from the current codebase:

1. Introduce platform-agnostic domain types and connector interfaces.
2. Replace `WhatsAppMessage` and `ChatRecord` assumptions with normalized conversation models.
3. Create a unified decision engine endpoint used by keyboard, live chat, and assistant.
4. Stand up a local database layer and stop persisting critical memory in `localStorage`.
5. Replace the current navigation shell with the new workspace hierarchy.
6. Convert commitment extraction into provenance-backed graph entities.
7. Move WhatsApp code into an isolated connector package.

---

## 9. Non-Negotiable Product Rules

- VAC must reason before it writes.
- VAC must be connector-based, never WhatsApp-based.
- VAC must be local-first and privacy-forward.
- VAC must unify insight modules into one intelligence pipeline.
- VAC must optimize the next message, not the dashboard.
- VAC must treat “no reply needed” as a core success case.

---

## 10. Decision

The current repository is a strong prototype, not the final architecture for a universal communication operating system.

The right move is not incremental page-by-page improvement.

The right move is a staged rearchitecture around:

- normalized connectors
- an encrypted memory graph
- a centralized decision engine
- a composer-first workspace
- shared cross-platform domain logic
