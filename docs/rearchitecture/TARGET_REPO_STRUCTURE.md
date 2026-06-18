# Target Repo Structure

This file translates the redesign into an implementable repository shape.

## Proposed Layout

```text
apps/
  web/
    src/
      routes/
      features/
        inbox/
        conversations/
        actions/
        memory/
        assistant/
      shells/
      providers/
  desktop/
  ios-keyboard/
  android-ime/
  browser-extension/

packages/
  domain/
    src/
      entities/
      value-objects/
      policies/
  storage/
    src/
      migrations/
      repositories/
      encryption/
  connectors/
    src/
      base/
      whatsapp/
      browser/
      email/
      telegram/
  memory-graph/
  context-engine/
  decision-engine/
  communication-engine/
  security/
  ui/

services/
  api/
  workers/
```

## Current-To-Target Mapping

- `src/pages/Dashboard.tsx` -> `apps/web/src/features/inbox`
- `src/pages/Chat.tsx` -> `apps/web/src/features/assistant`
- `src/pages/WhatsAppViewer.tsx` -> `apps/web/src/features/conversations`
- `src/pages/Commitments.tsx` -> `apps/web/src/features/actions`
- `src/pages/ToneLab.tsx` -> decision-engine and memory drill-down UI, not a standalone feature
- `src/pages/Psychology.tsx` -> memory and relationship intelligence views
- `src/pages/Schedule.tsx` -> decision-engine timing module
- `src/pages/LiveChat.tsx` -> connector-backed conversation workspace
- `src/lib/chatStore.ts` -> `packages/storage`
- `src/lib/commitments.ts` -> `packages/domain` plus `packages/storage`
- `server/whatsapp/*` -> `packages/connectors/src/whatsapp`
- `server/keyboard/suggest.js` -> `packages/communication-engine`
- `extension/*` -> `apps/browser-extension`
- `keyboard-ios/*` -> `apps/ios-keyboard`
- `keyboard-android/*` -> `apps/android-ime`

## Architectural Rule

No platform client should contain the core communication reasoning.

Platform clients may:

- capture context
- render suggestions
- submit send actions

Core packages must own:

- normalization
- memory
- decision policy
- generation strategy
- privacy controls
