# Planned Zenote V1 schema — not yet implemented

This is the source-of-truth plan for a future Zenote database schema. It does **not** create or authorize Appwrite tables, TablesDB collections, migrations, attributes, indexes, setup scripts, seed data, CRUD code, or schema provisioning. Appwrite Auth remains responsible for identity and passwords.

## Relationship diagram

```text
users
  │
  ├────< conversations
  │          │
  │          ├────< messages
  │          │         │
  │          │         └────< attachments
  │          │
  │          └────< runs
  │                    │
  │                    └────< run_steps
  │
  ├────< usage_events >──── models
  │
  ├────< subscriptions >──── plans
  │
  └──── user_preferences

models
  │
  └────< runs
```

## Planned tables

### `users`

Product profile associated with Appwrite Auth: `id`, `displayName`, `avatarUrl`, `role`, `createdAt`, `updatedAt`.

### `conversations`

`id`, `userId`, `title`, `modelId`, `systemPrompt`, `isPinned`, `isArchived`, `lastMessageAt`, `createdAt`, `updatedAt`.

Relationship: one `users` record has many conversations.

### `messages`

`id`, `conversationId`, `userId`, `role`, `content`, `status`, `parentMessageId`, `createdAt`, `updatedAt`.

Roles: `user`, `assistant`, `system`, `tool`. Statuses: `pending`, `streaming`, `completed`, `failed`.

Relationship: one conversation has many messages.

### `attachments`

`id`, `messageId`, `userId`, `type`, `provider`, `bucketId`, `storageKey`, `filename`, `mimeType`, `sizeBytes`, `metadata`, `createdAt`.

Types: `image`, `document`, `audio`, `video`, `other`. Keep provider, bucket, and key references provider-independent where practical.

### `runs`

`id`, `userId`, `conversationId`, `inputMessageId`, `outputMessageId`, `modelId`, `status`, `providerRequestId`, `startedAt`, `completedAt`, `errorCode`, `errorMessage`, `createdAt`.

Statuses: `queued`, `running`, `completed`, `failed`, `cancelled`.

A message is conversation content; a run is one AI execution.

### `run_steps`

`id`, `runId`, `type`, `name`, `status`, `input`, `output`, `startedAt`, `completedAt`, `createdAt`.

Planned types: `model`, `tool`, `agent`. This records future execution steps without committing Zenote to sophisticated agent features.

### `models`

`id`, `slug`, `name`, `provider`, `providerModelId`, `description`, `supportsVision`, `supportsFiles`, `supportsTools`, `supportsReasoning`, `contextWindow`, `inputCostPerMillion`, `outputCostPerMillion`, `isActive`, `isPremium`, `sortOrder`, `createdAt`, `updatedAt`.

### `usage_events`

Append-only usage ledger: `id`, `userId`, `runId`, `modelId`, `provider`, `inputTokens`, `outputTokens`, `cachedInputTokens`, `providerCostUsd`, `creditsCharged`, `createdAt`.

This ledger must eventually make usage and cost accounting auditable.

### `plans`

`id`, `slug`, `name`, `pricePhp`, `monthlyCredits`, `monthlyMessageLimit`, `isActive`, `createdAt`, `updatedAt`.

Initial conceptual plans are Free, Plus, and Pro. Exact prices and limits are not locked.

### `subscriptions`

`id`, `userId`, `planId`, `provider`, `providerCustomerId`, `providerSubscriptionId`, `status`, `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `createdAt`, `updatedAt`.

Statuses: `active`, `past_due`, `cancelled`, `expired`. Zenote's internal subscription model must remain independent from a payment provider.

### `user_preferences`

`id`, `userId`, `defaultModelId`, `theme`, `customInstructions`, `createdAt`, `updatedAt`.

One user has one preferences record.
