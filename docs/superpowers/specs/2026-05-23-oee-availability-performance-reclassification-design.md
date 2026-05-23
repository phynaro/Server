# OEE Availability / Performance Reclassification

**Date:** 2026-05-23  
**Status:** Approved  
**Standard:** ISO 22400-2

## Problem

The current OEE calculation treats Starved (state 2) and Blocked (state 3) as Availability losses, identical to a machine fault. This misattributes line-constraint losses — where the machine is mechanically ready but cannot cycle due to upstream/downstream conditions — as machine downtime. Management cannot distinguish between "machine broke" and "line was starved."

## Goal

Reclassify Starved and Blocked as Performance losses (minor stops), so Availability only reflects machine-side downtime (faults and operator-intervention stops). Maintain two distinct Availability KPIs with a meaningful gap between them.

## State-to-Bucket Map

| State | Code | Bucket | Rationale |
|---|---|---|---|
| Running | 1 | Uptime | Machine cycling |
| Starved | 2 | Uptime → reduces P | Line constraint, machine ready |
| Blocked | 3 | Uptime → reduces P | Line constraint, machine ready |
| Idle/Wait Operator | 4 | A loss | Always requires operator intervention |
| Faulted | 5 | A loss | Mechanical breakdown |
| Planned Stop | 6 | Excluded from AvailableTime | Scheduled non-production |

**Uptime** = RunTime + StarvedTime + BlockedTime

## Formula Changes

### oee_helper.js — calculateStateDurations()

| KPI | Old formula | New formula |
|---|---|---|
| Operational Availability | `RunTime / AvailableTime` | `Uptime / AvailableTime` |
| Technical Availability | `(Run + Starved + Blocked) / AvailableTime` | `(Run + Starved + Blocked + Idle) / AvailableTime` |
| Performance | `(ICT × Count) / RunTime` | `(ICT × Count) / Uptime` |
| MTBF | `Uptime / faultCount` | no change |
| MTTR | `FaultTime / faultCount` | no change (fault-only, by design) |
| totalLoss | `AvailableTime - RunTime` | `AvailableTime - Uptime` |

**OEE identity is preserved:**  
`OEE = A × P × Q = (ICT × Count × Q) / AvailableTime` — numerically identical to the old result for existing data. Only the A/P split changes.

**KPI semantics after change:**
- **Operational Availability** — penalises Faulted + Idle. "Was the machine ready, ignoring line constraints?"
- **Technical Availability** — penalises Faulted only. "Was the machine mechanically sound?" Always ≥ OA. The gap = IdleTime / AvailableTime = operator response loss.

## Frontend Changes

### oee.html — tooltip text only, no layout changes

**Availability (A) tooltip:**
- Formula line: `(Running + Starved + Blocked) / (Total Time − Planned Stops)`
- Description: Machine is Available when Running, Starved, or Blocked. Downtime is Faulted + Idle/Wait Operator (both require intervention to restore production).

**Performance (P) tooltip:**
- Formula line: `(ICT × Total Produced) / (Running + Starved + Blocked)`
- Description: Starved and Blocked are line-constraint minor stops — the machine was available but not cycling. They reduce P, not A.

**Technical Availability tooltip:**
- Formula line: `(Running + Starved + Blocked + Idle) / (Total Time − Planned Stops)`
- Description: Only mechanical faults (State 5) reduce this metric. Idle/Wait Operator is excluded — it reflects operator response speed, not machine reliability. The gap between TA and OA isolates operator-intervention loss.

**MTTR tooltip:**
- Sub-label: change from "Mean Time To Repair" to "Avg Fault Recovery Time"
- Description: Covers State 5 (Faulted) duration only. Operator-intervention (State 4) loss is visible via the gap between Technical and Operational Availability.

## Files Touched

- `oee_helper.js` — `calculateStateDurations()`: uptime variable, A formula, P formula, TA formula, totalLoss
- `public/oee.html` — four tooltip text blocks

## Out of Scope

- `reliability.html` / `scheduler_helper.js` — DailyKpiSummary and ReliabilityHistory are written by the scheduler which calls `calculateStateDurations()` indirectly through `updateMachineDay()`. These will pick up the new numbers automatically once oee_helper.js is updated. No schema changes needed.
- Pareto chart — already excludes state 1; reason bucketing is unaffected.
- `oee_client.js` — reads KPI fields by name; no changes needed.
