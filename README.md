# VAC

VAC is an AI-assisted communication workspace focused on WhatsApp conversations. Its primary product direction is now keyboard-first: VAC is meant to behave like an intelligent communication layer embedded directly into replying and typing, not just a dashboard or analytics tool. It helps a user import or live-connect chats, inspect message history, extract commitments, analyze tone, reason about relationship dynamics, and generate reply suggestions or auto-replies.

This repository contains:

- A React + TypeScript + Vite frontend.
- A local Express API layer for parsing chats and AI-backed analysis.
- A WhatsApp live bridge built on `whatsapp-web.js`.
- Local persistence for chats, commitments, tone history, notification preferences, and live-chat memory.

## What The Product Does

At a high level, VAC turns unstructured conversation history into a decision-support assistant and real-time writing copilot.

Core jobs:

1. Import a WhatsApp `.txt` export and normalize it into structured messages.
2. Store multiple chats locally and switch between them as working context.
3. Detect commitments, deadlines, promises, and follow-ups from chat text.
4. Analyze tone, urgency, emotion, and communication patterns.
5. Let the user ask an assistant questions about a loaded conversation.
6. Support a live WhatsApp bridge that can monitor messages, score them, and suggest or send replies.
7. Run a keyboard intelligence layer that helps the user decide what to say, how to say it, and whether to reply at all.

The product is less like a normal messenger and more like an “AI communication operating system” for reviewing conversations and deciding what to do next while the user is typing.

## Keyboard-First Product Model

The most important shift in VAC is that the reply box is now the center of the product.

The keyboard layer is where VAC should feel most valuable:

- Suggesting 3–5 context-aware replies above the input.
- Expanding a suggestion into a full editable draft.
- Coaching tone, timing, and phrasing while the user types.
- Surfacing hidden commitments or follow-ups at the exact moment they matter.
- Detecting when no reply is needed and avoiding over-messaging.

All major VAC systems exist to feed this layer:

- Context engine: full conversation history and current topic.
- Style engine: how the user naturally writes.
- Psychology engine: recipient mood, tension, and relationship preservation.
- Commitment engine: promises and pending loops.
- Scheduling engine: whether now is the right time to send.

## Main Product Areas

### 1. Dashboard / Overview

The dashboard is the landing page. It introduces VAC as an AI communication assistant and surfaces:

- Active imported chat context.
- Message counts and participant summaries.
- Open, overdue, and completed commitments.
- Quick-entry points into chat analysis, tone analysis, psychology, and commitments.

This page is designed as both a product overview and a workspace home.

### 2. Chat Assistant

The chat page is a conversational assistant layered on top of the currently active imported chat.

It can:

- Answer questions about a loaded conversation.
- Summarize themes and unresolved tension.
- Explain relationship dynamics.
- Help draft follow-up messages.
- Reason about commitments and loose ends.

It uses the current chat as context, and the assistant can be deep-linked from the commitments page with prefilled prompts like “plan next steps” or “draft follow-up”.

### 3. WhatsApp Viewer

The viewer is a structured message browser for imported chats.

Features:

- Search within the imported conversation.
- Filter by participant.
- Browse messages grouped by date.
- Switch between multiple imported chats.
- Export the normalized chat back out as plain text.

This is the “raw data inspection” surface of the product.

### 4. Commitments Assistant

This page turns chats into action items.

It supports:

- AI or rule-based commitment extraction.
- Manual commitment entry.
- WhatsApp import with commitment merging.
- Commitment status tracking: pending, in-progress, overdue, completed.
- AI fulfillment checks against pasted evidence or the loaded chat.
- Notification preferences and digest-style reminders.
- An assistant-style summary that identifies the top priority and proposes next actions.

This is one of the most product-defining parts of VAC. It is not just a todo list; it is meant to feel like a personal assistant for commitments hidden inside conversations.

### 5. Tone Lab

Tone Lab is a hybrid rules + AI analysis workspace.

It provides:

- Heuristic scoring for stress, anger, politeness, enthusiasm, and neutrality.
- Visualization with radar and trend charts.
- Chat-based loading from the active imported conversation.
- AI deep analysis via the local API when a provider is available.

Tone Lab is intended to help the user understand how a message reads, not just what it says.

### 6. Psychological Messaging

This page is a relationship and communication-pattern lens.

It combines:

- Rule-based nudges for impulse control and reply necessity.
- Style guidance based on relationship type.
- AI relationship analysis over an imported chat.
- Suggested replies based on communication dynamics.

This feature is more interpretive than Tone Lab. Tone Lab asks “how does this message sound?” while Psychology asks “what is happening between these people?”

### 7. Scheduling

The scheduling page helps determine when to send messages.

It combines:

- Contact or participant time-zone context.
- Inconvenient-hour warnings.
- Send-window suggestions.
- Basic activity inference from imported chat behavior.

This is a smaller support feature but fits the product’s “send smarter” positioning.

### 8. Live WhatsApp Bridge

The live page connects to WhatsApp through `whatsapp-web.js`.

It supports:

- QR-based linking.
- Live message ingestion.
- Real-time analysis events streamed over SSE.
- Suggested replies.
- Optional auto-reply modes.
- Per-chat reply logic and queueing.
- Feedback loops for reply outcomes.

This is the most operational part of the system. While imported chats are analytical and retrospective, the live bridge is about active message handling.

### 9. VAC Keyboard Layer

The keyboard layer lives inside the Live Chat reply area and simulates a native communication assistant.

It is designed to feel like:

- WhatsApp first.
- VAC second.

The user should still feel like they are typing, but with:

- Smarter suggestions.
- Better phrasing.
- More social awareness.
- Fewer unnecessary replies.

Current keyboard-layer behaviors:

- Suggestion bar with multiple reply variants.
- Deep Compose panel for editing before send.
- Inline phrase completion and rewrite actions.
- Tone coaching and send-timing guidance.
- Commitment awareness directly in the compose area.
- A “no reply needed” state when VAC detects closure.

## Frontend And UI Character

The frontend uses React 19, React Router, Vite, and Tailwind v4 utilities mixed with custom CSS tokens.

Current design direction:

- Rounded, soft geometry with large radii.
- Bright blue accent styling inspired by Framer-like product blocks.
- Light glassmorphism in cards and navigation.
- High whitespace, dashboard-style composition.
- Utility-driven layout with some handcrafted inline styling.

UI tone:

- Feels like a productivity + AI assistant tool.
- More “analysis workspace” than “consumer chat app”.
- Uses compact cards, status chips, metrics, and assistant prompts.

If a third party is redesigning the UI, the key product challenge is to preserve the feeling that VAC is simultaneously:

- A conversation browser.
- A personal assistant.
- An AI analysis console.
- A live WhatsApp operations panel.

## AI Architecture

The backend prefers Anthropic when `ANTHROPIC_API_KEY` is available.

Fallback order:

1. Anthropic Claude
2. Local Ollama model
3. Rules / heuristics, depending on the feature

AI is used for:

- Chat assistant replies.
- Commitment extraction.
- Fulfillment checking.
- Tone analysis.
- Relationship / psychology analysis.
- Live message analysis and suggested replies.

Rules-based fallback exists for core functionality so the product remains partially usable without a cloud key.

## Data Flow

### Imported Chat Flow

1. User imports a WhatsApp `.txt` export.
2. The local API parses lines into structured messages.
3. Messages are stored in local chat storage.
4. Plain-text context is generated for AI features.
5. Commitments are extracted and tagged to the chat.
6. The imported chat becomes the active analysis context.

### Live Chat Flow

1. User starts the WhatsApp bridge.
2. The bridge connects through QR login.
3. Incoming events are broadcast over SSE.
4. The live page renders messages, analysis, and suggested replies.
5. Live chats can be imported into the main chat store and commitment system.

## Persistence Model

Most frontend state is stored locally in browser storage.

Examples:

- Chat store and active chat selection.
- Chat assistant history.
- Commitments and statuses.
- Tone history.
- Notification preferences.
- Imported WhatsApp context.

The live WhatsApp bridge also uses local server-side files for config and chat memory.

## Running The Project

### Recommended

```bash
npm install
npm run dev
```

This starts:

- Vite frontend on `http://127.0.0.1:5174/` or the next open port.
- Local API on `http://127.0.0.1:8787/`.

### Why `server/dev.js` Exists

In this environment, the plain Express entry could exit immediately after startup. `server/dev.js` imports the API entry and keeps a lightweight interval alive so local development is stable.

### Optional AI Configuration

Cloud AI:

```bash
ANTHROPIC_API_KEY=...
```

Optional local model fallback:

- Run Ollama locally.
- Ensure a model is available, such as `llama3.2:3b`.

### Optional WhatsApp Live Mode

The live bridge depends on `whatsapp-web.js` and a QR-authenticated WhatsApp session. Once started, the live page can stream chat events and suggested replies.

## Important Files

- `src/App.tsx`: route wiring.
- `src/components/Layout.tsx`: global shell and navigation.
- `src/context/ChatContext.tsx`: imported/live chat state and commitment linkage.
- `src/pages/Dashboard.tsx`: overview and navigation hub.
- `src/pages/Chat.tsx`: conversation assistant.
- `src/pages/WhatsAppViewer.tsx`: structured imported-chat viewer.
- `src/pages/Commitments.tsx`: commitment extraction and tracking.
- `src/pages/ToneLab.tsx`: tone analysis workspace.
- `src/pages/Psychology.tsx`: relationship-analysis workspace.
- `src/pages/LiveChat.tsx`: WhatsApp live operations UI.
- `server/index.js`: local API entry.
- `server/dev.js`: stable local dev wrapper for the API.
- `server/claudeClient.js`: provider selection and AI client logic.
- `server/parseWhatsAppExport.js`: WhatsApp export parsing.
- `server/whatsapp/controller.js`: live bridge orchestration.

## How To Think About VAC As A Product

VAC is not only a chat viewer and not only a reply generator.

A better mental model is:

“An AI-assisted workspace for understanding, organizing, and acting on WhatsApp conversations, with the keyboard as the primary interaction surface.”

That means a redesign should not reduce the product to a single chat screen. The product value comes from the combination of:

- Context-rich conversation browsing.
- Action extraction.
- Emotional and relational analysis.
- Live operational assistance.

## UI Redesign Notes

If this README is being used to plan a stronger UI, the redesign should make these distinctions clearer:

1. Imported analysis mode vs live operations mode.
2. Raw conversation data vs AI interpretation.
3. Commitments/tasks vs messages.
4. Personal assistant guidance vs system controls.

The best next-level UI would likely organize VAC around a clearer information hierarchy:

- Conversation context
- Analysis
- Actions
- Live assistant

instead of treating every page as a separate utility.
