# F-005 — Event Types, Pre-Event Stages and Reminders

Status: Draft v0.1 · Depends on: F-001, F-004 · Used by: F-006, F-007, F-008, F-010

## 1. Purpose

An **event type** is a template that controls how its events behave:

- which studios it can use, and its duration limits;
- its **pre-event stage schedule**: reminders and tasks at set offsets before the event starts;
- its **post-event steps**: check-in deadline, results upload, sponsor sign-off (F-008).

Admins manage event types. Examples: "Class Project Shoot", "Podcast Recording", "Thesis Production".

## 2. Data model

```mermaid
erDiagram
  EVENT_TYPE {
    uuid id PK
    string name UK
    string description
    string status "active|inactive"
    int max_days "1 = single-day only"
    int max_hours_per_day
    bool daily_equipment_return "default false"
    int pickup_window_minutes "checkout opens N min before start, default 60"
    int checkin_grace_minutes "default 60 after last day end"
    bool requires_results "F-008"
    int results_due_days "after event end"
    bool requester_can_upload
    bool requires_sponsor_signoff "F-008"
  }
  EVENT_TYPE_STUDIO {
    uuid event_type_id FK
    uuid studio_id FK
  }
  STAGE_TEMPLATE {
    uuid id PK
    uuid event_type_id FK
    int seq
    string name "e.g. Pre-production meeting"
    string kind "reminder|task"
    string anchor "event_start|event_end|each_day_start"
    int offset_minutes "negative = before anchor"
    string recipients "requester,participants,sponsor,studio_staff"
    string assignee_role "task only: requester|sponsor|studio_staff"
    bool blocks_checkout "task only"
    string channels "email,in_app"
    uuid message_template_id FK
  }
  STAGE_INSTANCE {
    uuid id PK
    uuid event_id FK
    uuid stage_template_id FK
    datetime due_at
    string status "scheduled|sent|skipped|open|done|overdue|overridden|cancelled"
    uuid completed_by FK
    datetime completed_at
    string override_reason
  }
  EVENT_TYPE ||--o{ EVENT_TYPE_STUDIO : "allowed in"
  EVENT_TYPE ||--o{ STAGE_TEMPLATE : defines
  STAGE_TEMPLATE ||--o{ STAGE_INSTANCE : "instantiated as"
```

## 3. Example reminder schedule ("Thesis Production")

| Seq | Stage | Kind | Anchor / offset | Recipients | Blocks checkout |
|---|---|---|---|---|---|
| 1 | Booking confirmed summary | reminder | event_start −14d | requester, sponsor | — |
| 2 | Submit shot list | task (requester) | event_start −7d | requester | No |
| 3 | Safety briefing acknowledged | task (requester) | event_start −3d | requester, studio_staff | **Yes** |
| 4 | Tomorrow: pickup details | reminder | event_start −1d | requester, participants | — |
| 5 | Equipment ready for pickup | reminder | event_start −1h | requester | — |
| 6 | Daily start reminder | reminder | each_day_start −1h | requester, participants | — |
| 7 | Return equipment | reminder | event_end −30m | requester | — |

## 4. Stage instance lifecycle

```mermaid
stateDiagram-v2
  direction LR
  state "Reminder" as R {
    [*] --> scheduled
    scheduled --> sent: due_at reached
    scheduled --> skipped: due_at already past at confirmation
    state "cancelled" as r_cancelled
    scheduled --> r_cancelled: event cancelled
  }
  state "Task" as T {
    [*] --> open
    open --> done: assignee completes
    open --> overdue: due_at passed
    overdue --> done: assignee completes
    overdue --> overridden: staff override (reason)
    open --> cancelled: event cancelled
    overdue --> cancelled: event cancelled
  }
```

A task opens as soon as the event is confirmed, so it can be completed early. Its `due_at` is the deadline. Recipients get a notification when the task opens, and again at `due_at` if it is still not done.

## 5. Scheduling algorithm

```mermaid
flowchart TD
  A[Event enters Confirmed] --> B[For each stage template of the event type]
  B --> C{anchor = each_day_start?}
  C -- yes --> D[One instance per event day]
  C -- no --> E[One instance]
  D & E --> F[due_at = anchor time + offset]
  F --> G{kind}
  G -- reminder --> H{due_at ≤ now?}
  H -- yes --> I[status = skipped]
  H -- no --> J[status = scheduled → job queue]
  G -- task --> K[status = open, notify assignee]
```

## 6. Business rules

- **BR-005-01** Stage instances are created when an event is **Confirmed** (F-006), not when it is submitted.
- **BR-005-02** If an event is rescheduled (its days change), reminders that have not been sent and tasks that are not done are recalculated from the new anchors. Reminders already sent are not re-sent. Completed tasks stay completed.
- **BR-005-03** Cancelling an event cancels every stage instance that is still `scheduled`, `open`, or `overdue`.
- **BR-005-04** A reminder whose `due_at` has already passed when the event is confirmed is `skipped`, not sent late. The exception is the first stage: a booking confirmation is always sent immediately (F-010).
- **BR-005-05** At checkout (F-007), any task with `blocks_checkout=true` that is not `done` or `overridden` blocks the checkout. Studio Staff may override it with a reason, which is audited (D-15).
- **BR-005-06** Only the assignee role, Studio Staff for that studio, or an Admin can complete a task.
- **BR-005-07** Editing an event type's stages affects only events confirmed **after** the edit. Existing instances keep the template version they were created from. Instances store a snapshot of name, offset, and recipients.
- **BR-005-08** An event type can only be deactivated if it has no events in non-terminal states, or the Admin confirms that existing events will keep running under the old version.
- **BR-005-09** Each event type must allow at least one studio. A request may only use an allowed studio.
- **BR-005-10** Offsets are limited to −90 days … +30 days. Reminders landing between 22:00 and 07:00 campus time are moved to 07:00, unless the event starts before 09:00 that day. Quiet hours are configurable.
- **BR-005-11** Message templates support the placeholders `{event.title}`, `{studio.name}`, `{event.first_day}`, `{event.days}`, `{equipment.list}`, `{pickup.window}`, `{links.event}`, `{task.name}`.

## 7. User stories

**US-005-01 — Admin defines a reminder schedule**
- AC1: Given an Admin editing "Podcast Recording", when they add a reminder at event_start −24h to the requester by email + in-app, then events of this type confirmed afterwards get that reminder.

**US-005-02 — Late confirmation**
- AC1: Given an event starting in 2 days, when it is confirmed, then reminders with offsets of −7d and −3d are `skipped`, and the −1d reminder is `scheduled`.

**US-005-03 — Blocking task**
- AC1: Given an incomplete "Safety briefing" task with `blocks_checkout=true`, when staff start checkout, then checkout is blocked and shows the task name, with an "Override" action that requires a reason.

**US-005-04 — Multi-day reminders**
- AC1: Given a 3-day event and a stage anchored to each_day_start −1h, when it is confirmed, then 3 instances are created, one per day.

## 8. Open questions

- OQ-005-1: Should tasks be able to collect data (e.g. upload a shot list file, tick a checklist), or just be marked done?
- OQ-005-2: Should sponsors get reminders by default, or only when the type says so?
- OQ-005-3: Do some event types skip staff confirmation and auto-confirm after sponsor approval?
