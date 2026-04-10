# Study Visit Modeling Tool

An interactive planning tool for projecting monthly visit load in clinical research studies. Built as a single-file React component that runs in the browser — useful for protocol design, coordinator staffing, and capacity discussions with study teams.

## What it does

Given a study design (cohort size, enrollment pace, visit schedule, and attrition assumptions), the tool projects how many visits will occur each month over the study lifetime and surfaces the numbers most useful for planning:

- **Peak visits/month** and the month it occurs — for staffing the busiest stretch
- **Total visits** over the study lifetime — for budgeting and effort estimation
- **Study duration** — last enrollment + longest follow-up window
- **Steady-state load** — average visits/month in the stable post-enrollment phase
- **Stacked bar chart** showing visits per month broken down by visit type

## Modeling approach

### Visit types

The tool distinguishes two kinds of visits:

- **Scheduled** visits occur at a fixed month offset from enrollment (e.g. baseline at 0, 3-month, 6-month, 1-year). Each participant contributes one visit per scheduled type.
- **Unscheduled** visits occur at a yearly rate during a follow-up window (e.g. flares at 2/year over the first 12 months). These model events that can't be put on a calendar in advance.

Both types are fully editable — add, remove, or rename visits to match any protocol.

### Attrition and adherence

Two parameters reduce visit counts from the theoretical maximum:

- **Annual dropout rate** is converted to a monthly retention probability via `(1 - annual)^(1/12)`. Each scheduled visit is weighted by the probability the participant is still enrolled at that point. Baseline visits are exempt (enrollment *is* baseline by definition).
- **No-show rate** is applied as a flat per-visit probability. Both scheduled and unscheduled visits are subject to no-show.

### Deterministic vs. stochastic modes

- **Deterministic** mode computes expected values directly: scheduled visits are weighted by retention probability, unscheduled events use rate × active population × show rate. Smooth, reproducible, and the right answer for capacity planning ("what should I budget for month 18?").
- **Stochastic** mode runs N independent Monte Carlo simulations. Each participant has a sampled dropout month, each scheduled visit has an independent no-show draw, and unscheduled events are drawn from a Poisson distribution. Results are averaged across runs. Useful for understanding variability and worst-case weeks. A "Re-run simulation" button generates a fresh realization.

## Inputs

| Parameter | Default | Notes |
|---|---|---|
| Participants | 60 | Total cohort size |
| Enrollment / month | 4 | Determines how long enrollment takes |
| Annual dropout (%) | 15 | Converted to monthly retention internally |
| No-show rate (%) | 10 | Applied per visit; baseline exempt |
| Mode | Deterministic | Switch to stochastic for variability |
| Simulation runs | 100 | Stochastic mode only |
| Visit schedule | 6 visits | Fully editable — see below |

The default visit schedule reflects a 1-year autoimmune cohort study: baseline, 1-month, 3-month, 6-month, 1-year scheduled visits, plus flares as an unscheduled event at 2/year over 12 months.

## Editing the visit schedule

The visit schedule panel lets you:

- Rename any visit
- Switch a visit between scheduled and unscheduled
- For scheduled visits, set the month offset from enrollment
- For unscheduled visits, set the yearly rate and the follow-up window (how long after enrollment the event can occur)
- Add new scheduled or unscheduled visits
- Remove visits

The study duration auto-extends to fit the longest follow-up, so adding a 24-month visit will expand the chart and stats automatically.

## Example use cases

- **Short PK study**: scheduled visits at 0, 0.25, 0.5, 1, 2 months; no unscheduled events
- **Long observational cohort**: scheduled at 0, 6, 12, 24, 36 months with a "hospitalization" unscheduled event at 0.5/year over 36 months
- **Acute-phase intervention**: scheduled at 0, 1, 2, 4 weeks with adverse-event monitoring as unscheduled at 4/year over 3 months

## Tech stack

- React (functional components, hooks)
- Recharts for the stacked bar chart
- Tailwind utility classes for styling
- No external state management, no backend, no persistence — everything runs in the browser

## Known limitations

- **Visit colors cycle through a 10-color palette by order.** Reordering or inserting visits will shift colors. Fine for planning; flag if you want stable per-visit colors.
- **Dropout is modeled as constant hazard.** Real studies often see front-loaded attrition (more dropout in the first few months). The current model is conservative for long studies and slightly optimistic for short ones.
- **No-show is independent across visits.** In reality, a participant who no-shows once is more likely to no-show again. The current model averages out correctly but understates clustering.
- **Unscheduled event rate is constant within the follow-up window.** Doesn't capture disease activity that varies over time (e.g. flares concentrated early, then tapering).
- **No screening or run-in phase.** Enrollment is assumed to equal baseline. If your protocol has a screening visit before baseline, model it as a separate scheduled visit at month 0 and accept that the timing is approximate.
- **Calendar months only.** No weekly or daily resolution.

## Possible extensions

- Front-loaded dropout (e.g. Weibull hazard)
- Per-visit no-show rates (some visits are easier to attend than others)
- Time-varying unscheduled event rates
- CSV export of the projected dataset
- Confidence bands around stochastic projections (currently shows means only)
- Save/load named protocols

## File structure

```
study-visit-model.jsx    # The entire tool — single component, no dependencies beyond React + Recharts
README.md                # This file
```

## License

Internal research tool. Adapt freely.
