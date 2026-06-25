# 14 - MOD-19: Workforce, tasks, training, SOPs and communication

Source: `documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md` (lines 2126-2242)

# 19. MOD-14 - Workforce, tasks, training, SOPs and communication

## 19.1 Purpose

Coordinate people, recurring and exception work, competencies, training and current procedures so that every task has an accountable owner and workers can access the correct instructions at the point of work.

## 19.2 Primary users

All operational users, supervisors, managers, HR/training administrators, quality and contractors.

## 19.3 Capabilities

- Define task templates with trigger, checklist, priority, skill, SLA, evidence and escalation.
- Create tasks manually or from flock stage, alert, observation, health case, audit, inventory, maintenance or schedule.
- Assign by named user, role, team, shift, house/site and on-call rule.
- Support due date/time, recurrence, dependency, reassignment, delegation and escalation.
- Capture status, notes, checklist responses, time, materials, photos and sign-off.
- Create shift rosters/assignments or integrate with an external workforce system.
- Maintain competency/authorization requirements for treatment, vaccination, machinery, electrical, biosecurity and controller actions.
- Maintain training courses, required audience, renewal period, completion and evidence.
- Maintain controlled SOP/document acknowledgements and link procedures to modules, assets, houses and tasks.
- Provide shift handover, announcements and targeted operational communication.
- Support contractors/temporary workers with induction and time/location-limited access.

## 19.4 Task state model

```text
planned -> assigned -> accepted -> in_progress -> completed -> verified -> closed
                     \-> blocked / waiting -> in_progress
planned/assigned -> cancelled (authorized reason)
```

High-risk tasks may require a separate verifier.

## 19.5 Core workflows

### Task from finding

1. Source module creates task with context, severity, house/flock/asset and evidence.
2. Assignment engine selects responsible role/user based on site, shift and availability.
3. User accepts or supervisor reassigns.
4. User completes checklist and records result/evidence.
5. Required verifier approves; source finding/alert is updated with linked outcome.

### Training authorization

1. Administrator defines a competency and required course/assessment.
2. Role/action mapping states which competency is required.
3. Training completion and expiry are recorded.
4. Server Action checks active authorization before high-risk action.
5. Expiring competency creates notification and future task; expired competency removes action permission even if the user retains a general role.

## 19.6 Key entities

| Entity/table | Important fields |
|---|---|
| `task_templates` / `task_template_versions` | Trigger, checklist, skill, priority, SLA, evidence and approval. |
| `tasks` | Source, scope, assignee/team, status, priority, due, completion and verification. |
| `task_dependencies` | Predecessor/successor, dependency type and status. |
| `task_comments` / `task_evidence` | User, time, note, file and visibility. |
| `teams` / `team_members` | Site/role membership, on-call schedule and status. |
| `shifts` / `shift_assignments` | Schedule, site/house, responsibility and attendance reference. |
| `competencies` | Name, scope, issuing authority, validity and status. |
| `user_competencies` | User, evidence, assessed date, expiry and restriction. |
| `training_courses` / `training_requirements` | Content, audience, recurrence and assessment. |
| `training_records` | User, completion, score, evidence, expiry and approver. |
| `announcements` | Audience, priority, valid period, acknowledgement and attachment. |
| `handovers` | Shift/site scope, unresolved items and receiving acknowledgement. |

## 19.7 Business rules

- The source of an automatically created task is immutable and traceable.
- Task completion does not automatically close the source alert/incident unless verification criteria are met.
- Users cannot perform configured high-risk actions with expired/missing competency.
- Recurring task generation is idempotent for the same schedule occurrence.
- Overdue/escalation timers use the site's time zone and approved calendar.
- Superseded SOPs are unavailable for new work but remain linked to historical events.
- Contractor access and training expire automatically.

## 19.8 UI and routes

- `/today/tasks`
- `/tasks`
- `/tasks/[taskId]`
- `/schedule`
- `/teams`
- `/training`
- `/competencies`
- `/sops`
- `/handovers`
- `/announcements`

## 19.9 Events and alerts

- `task.created`
- `task.assigned`
- `task.overdue`
- `task.completed`
- `task.verification_failed`
- `training.required`
- `training.expiring`
- `competency.expired`
- `announcement.critical`

## 19.10 KPIs

Task completion/on-time rate, overdue age, reassignment, repeat finding, workload by role/site, verification failure, training compliance, competency gaps and handover acknowledgement.

## 19.11 Module acceptance gate

- Tasks from multiple modules retain source context and can be completed offline where appropriate.
- High-risk actions are blocked when competency or authorization is absent/expired.
- Current SOP version is available at the point of work and the used version is retained historically.
- Overdue tasks escalate according to site/role policy.

---


---

*Source: documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md (lines 2126-2242)*
