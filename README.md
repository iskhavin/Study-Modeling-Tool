# Study Visit Modeling Tool

An interactive planning tool for projecting monthly visit load and sample storage requirements in clinical research studies. Built as a single-file React component that runs in the browser — useful for protocol design, coordinator staffing, freezer capacity planning, and logistics discussions with study teams.

## What it does

Given a study design (cohort size, enrollment pace, visit schedule, and attrition assumptions), the tool projects how many visits will occur each month over the study lifetime and surfaces the numbers most useful for planning:

- **Peak visits/month** and the month it occurs — for staffing the busiest stretch
- **Total visits** over the study lifetime — for budgeting and effort estimation
- **Study duration** — last enrollment + longest follow-up window
- **Steady-state load** — average visits/month in the stable post-enrollment phase
- **Stacked bar chart** showing visits per month broken down by visit type

A collapsible **Sample Storage Projection** module extends the visit model to estimate freezer space requirements over the study lifetime (see below).

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

These same attrition and no-show adjustments flow through automatically into the sample storage calculations.

### Deterministic vs. stochastic modes

- **Deterministic** mode computes expected values directly: scheduled visits are weighted by retention probability, unscheduled events use rate × active population × show rate. Smooth, reproducible, and the right answer for capacity planning ("what should I budget for month 18?").
- **Stochastic** mode runs N independent Monte Carlo simulations. Each participant has a sampled dropout month, each scheduled visit has an independent no-show draw, and unscheduled events are drawn from a Poisson distribution. Results are averaged across runs. Useful for understanding variability and worst-case weeks. A "Re-run simulation" button generates a fresh realization.

## Inputs

| Parameter | Default | Notes |
|---|---|---|
| Study name | *(blank)* | Optional label displayed in the page header |
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

## Sample Storage Projection

The storage module is a collapsible section below the visit chart. It takes the visit model output and estimates how much freezer space the study will consume over its lifetime. When collapsed, it shows a one-line peak-box summary by freezer tier.

### How it works

For each month, the model multiplies expected visit attendance (already adjusted for dropout and no-show) by the aliquot counts you configure. These monthly additions accumulate into a running total — samples are assumed to be retained for the full study duration. Box counts are derived by dividing total aliquots by the box capacity you specify.

### Sample type registry

Define each sample type with:

- **Name** (e.g. Serum, PBMC, Urine)
- **Freezer tier** — one of −80°C, −20°C, 4°C, or Room temp
- **Box capacity** — slots per box (e.g. 81 for a standard 9×9 cryobox)

The inline summary next to each sample type shows total projected aliquots and boxes at a glance.

### Collection matrix

A grid of sample types × visits lets you specify how many aliquots are collected at each visit. Any combination is valid — leave a cell at 0 to skip that sample type at that visit. For unscheduled visits (e.g. flares), the count is aliquots per event occurrence; the expected number of events is drawn from the visit model.

The default matrix reflects a typical autoimmune study: serum at every visit, PBMC at baseline and 1-year only, urine at all scheduled visits but not flares.

### Storage outputs

- **Peak boxes by freezer tier** — stat cards showing maximum boxes needed at end of study, with a per-sample-type breakdown in the subtext
- **Total aliquots** across all sample types
- **Cumulative storage by freezer tier** — stacked area chart showing how −80°C, −20°C, etc. boxes accumulate month by month
- **Cumulative storage by sample type** — second stacked area chart showing the same accumulation broken down by individual sample type, with freezer tier noted in the legend

Box counts are shown as fractional values in charts for smooth projections; round up for actual freezer procurement decisions.

## Example use cases

- **Short PK study**: scheduled visits at 0, 0.25, 0.5, 1, 2 months; no unscheduled events; plasma and whole blood collected at every visit
- **Long observational cohort**: scheduled at 0, 6, 12, 24, 36 months with a "hospitalization" unscheduled event at 0.5/year over 36 months; serum and urine at scheduled visits only
- **Acute-phase intervention**: scheduled at 0, 1, 2, 4 weeks with adverse-event monitoring as unscheduled at 4/year over 3 months; dense sample collection at early visits tapering off

## Tech stack

- React (functional components, hooks)
- Recharts for the stacked bar and area charts
- Tailwind utility classes for styling
- No external state management, no backend, no persistence — everything runs in the browser

## Known limitations

- **Visit colors cycle through a 10-color palette by order.** Reordering or inserting visits will shift colors. Fine for planning; flag if you want stable per-visit colors.
- **Dropout is modeled as constant hazard.** Real studies often see front-loaded attrition (more dropout in the first few months). The current model is conservative for long studies and slightly optimistic for short ones.
- **No-show is independent across visits.** In reality, a participant who no-shows once is more likely to no-show again. The current model averages out correctly but understates clustering.
- **Unscheduled event rate is constant within the follow-up window.** Doesn't capture disease activity that varies over time (e.g. flares concentrated early, then tapering).
- **No screening or run-in phase.** Enrollment is assumed to equal baseline. If your protocol has a screening visit before baseline, model it as a separate scheduled visit at month 0 and accept that the timing is approximate.
- **Calendar months only.** No weekly or daily resolution.
- **Samples accumulate monotonically.** The storage model assumes all samples are retained for the full study duration. Studies with defined sample discard policies or interim analysis freezedowns are not yet modeled.
- **Box capacity is uniform per sample type.** All boxes for a given sample type are assumed to have the same slot count. Mixed box sizes in a single sample type are not supported.

## Possible extensions

- Front-loaded dropout (e.g. Weibull hazard)
- Per-visit no-show rates (some visits are easier to attend than others)
- Time-varying unscheduled event rates
- Sample retention periods (free up slots after N months)
- CSV export of the projected visit and storage dataset
- Confidence bands around stochastic projections (currently shows means only)
- Save/load named protocols

## File structure

```
study-visit-model.jsx    # The entire tool — single component, no dependencies beyond React + Recharts
README.md                # This file
```

## License

Internal research tool. Adapt freely.
