# F-007 — Equipment Checkout, Check-in and Holds

Status: Draft v0.1 · Depends on: F-003, F-005, F-006 · Used by: F-008

## 1. Purpose

Hand reserved equipment to the requester when the event starts, take it back afterwards and record its condition, and place a **hold** on the student's account when something is late, damaged, or lost (D-18).

## 2. Data model

```mermaid
erDiagram
  CHECKOUT_RECORD {
    uuid id PK
    uuid event_id FK
    uuid equipment_line_id FK
    uuid unit_id FK "serialized only"
    int qty "bulk only"
    datetime out_at
    uuid out_by FK "staff"
    string condition_out "ok + notes"
    datetime due_at
    datetime in_at
    uuid in_by FK
    string condition_in "ok|damaged|missing"
    int qty_ok "bulk"
    int qty_damaged "bulk"
    int qty_missing "bulk"
    string notes
    bool late
  }
  CHECKOUT_PHOTO {
    uuid id PK
    uuid checkout_record_id FK
    string phase "out|in"
    string storage_key
  }
  ACKNOWLEDGEMENT {
    uuid event_id FK
    uuid user_id FK
    string terms_version
    datetime at
  }
  HOLD {
    uuid id PK
    uuid user_id FK
    string reason "LATE_RETURN|DAMAGE|LOSS|MANUAL"
    uuid event_id FK
    string status "active|cleared"
    string source "system|staff"
    string note
    datetime auto_clear_at "LATE_RETURN only"
    uuid cleared_by FK
    string cleared_reason
    datetime created_at
  }
  CHECKOUT_RECORD ||--o{ CHECKOUT_PHOTO : has
```

## 3. Checkout

```mermaid
sequenceDiagram
  actor R as Requester
  actor ST as Studio Staff
  participant APP as App
  ST->>APP: Open event (pickup window open)
  APP->>APP: Pre-checks (BR-007-02)
  alt Pre-check fails
    APP-->>ST: Show blockers (blocking task, hold, eligibility, review flag)
    ST->>APP: Resolve or override (reason) where allowed
  end
  loop Each equipment line
    ST->>APP: Scan asset tag (serialized) / enter qty (bulk)
    APP->>APP: Validate unit type matches line, status=available
    ST->>APP: Condition-out notes / photos (optional)
  end
  R->>APP: Acknowledge terms (staff device or own login)
  ST->>APP: Complete checkout
  APP->>APP: Units → in_use, event → InProgress,<br/>due_at = last day end + checkin_grace
  APP->>R: Checkout receipt (items, due time)
```

## 4. Check-in

```mermaid
flowchart TD
  A[Staff opens event for check-in] --> B[Scan / count each outstanding item]
  B --> C{Condition}
  C -- ok --> D[Unit → available]
  C -- damaged --> E[Unit → damaged<br/>notes + photo required]
  C -- missing --> F[Stays in_use, marked missing]
  D & E & F --> G{Returned after due_at?}
  G -- yes --> H[late = true]
  G -- no --> I[On time]
  H & I --> J{All lines resolved?}
  J -- no --> K[Event stays PostEvent<br/>reminders to requester]
  J -- yes --> L[Check-in report generated<br/>F-008 step complete]
  E --> M[Hold: DAMAGE]
  H --> N[Hold: LATE_RETURN]
  F --> O{Still missing after<br/>lost_after_days?}
  O -- yes --> P[Unit → lost<br/>Hold: LOSS]
```

## 5. Hold lifecycle

```mermaid
stateDiagram-v2
  [*] --> active: system rule or staff
  active --> cleared: Equipment Mgr / Admin clears (reason)
  active --> cleared: auto_clear_at reached (LATE_RETURN only)
  cleared --> [*]
```

## 6. Business rules

- **BR-007-01** Checkout opens `pickup_window_minutes` before the first day's start. It can be done until the NO_SHOW cutoff (BR-006-13).
- **BR-007-02** **Pre-checks** at checkout:
  1. the event is Confirmed;
  2. `needs_review` is false, or staff resolve it now;
  3. no blocking task is incomplete, or staff override it (BR-005-05);
  4. the requester is eligible for every line on every remaining day (F-002);
  5. the requester has no active hold, or a Manager/Admin clears it (the hold itself cannot be overridden).
- **BR-007-03** An event with no equipment is still "started" by staff (a checkout with zero lines). This moves it to InProgress and avoids a NoShow.
- **BR-007-04** A scanned unit must be of the line's equipment type (or a component of the kit) and `available`. Staff may swap in another unit of the same type. Changing to a different type needs the line edited (counts as a change to the event, BR-006-10) and the requester's acknowledgement.
- **BR-007-05** Partial checkout is allowed. Lines that are not filled are recorded with a reason (`unit_unavailable`, `declined_by_requester`). Their reserved quantity is released.
- **BR-007-06** Only the **requester** can receive equipment. Participants cannot. Before each checkout, the requester accepts the current terms (version recorded).
- **BR-007-07** For event types with `daily_equipment_return=true`, each day has its own checkout and check-in. Each day's `due_at` is that day's end + grace.
- **BR-007-08** Check-in can be done by Studio Staff of the event's studio, or by an Equipment Manager. Equipment may be returned to any staff member at that studio.
- **BR-007-09** Damaged items need a note and at least one photo.
- **BR-007-10** **Automatic holds** (D-18):

  | Trigger | Hold reason | Clears |
  |---|---|---|
  | Any item returned after `due_at` | LATE_RETURN | Automatically 7 days after the last item is returned (configurable), or manually |
  | Any item checked in as damaged | DAMAGE | Manually, by Equipment Manager/Admin |
  | Item still missing `lost_after_days` (default 7) after due_at | LOSS | Manually |

  One hold per reason per event. Staff can also add MANUAL holds with a note.
- **BR-007-11** An active hold blocks new submissions (F-006 §5). It also flags the student's other events in Submitted, SponsorApproved, or Confirmed with `needs_review` reason `HOLD_ACTIVE`.
- **BR-007-12** When a hold is placed, the student and the event's sponsor are notified, with the reason and the item list. When it is cleared, the student is notified.
- **BR-007-13** Overdue reminders go to the requester at due_at, then daily until everything is returned (or marked lost). Studio staff get a daily overdue digest.
- **BR-007-14** Check-in is complete when every line is `ok`, `damaged`, or `lost`. Completing it generates the **check-in report** (items, condition out/in, timestamps, staff, photos, holds placed), which is attached to the result package (F-008).
- **BR-007-15** Scanning works with USB/Bluetooth barcode scanners (which act as keyboards) and with the device camera (QR/barcode) in the browser.

## 7. User stories

**US-007-01 — Standard checkout**
- AC1: Given a Confirmed event with 1 FX6 Kit and 4 XLR cables, when staff scan FX6-02 and its kit components, enter 4 cables, and the requester acknowledges the terms, then FX6-02 and its components become `in_use`, bulk XLR goes available −4 / in_use +4, and the event is InProgress.

**US-007-02 — Blocked by hold**
- AC1: Given the requester got a DAMAGE hold after their event was confirmed, when staff open checkout, then checkout is blocked with the hold details. Only a Manager/Admin clearing the hold unblocks it.

**US-007-03 — Late return**
- AC1: Given due_at Apr 12 19:00, when the items are checked in Apr 13 10:00 in good condition, then they become `available`, `late=true`, and a LATE_RETURN hold is placed with auto_clear_at Apr 20 10:00.

**US-007-04 — Missing becomes lost**
- AC1: Given 1 XLR cable missing at check-in, when 7 days pass after due_at, then the missing quantity moves to `lost`, a LOSS hold is placed, and the sponsor is notified.

**US-007-05 — Damage**
- AC1: When staff check in FX6-02 as damaged without a photo, then check-in for that line cannot be saved.

## 8. Open questions

- OQ-007-1: Should the requester sign at checkout (drawn signature), or is a recorded checkbox acknowledgement enough?
- OQ-007-2: Should LATE_RETURN holds get longer for repeat offences?
- OQ-007-3: Can a participant collect equipment if the requester delegates it?
