import React, { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// Color palette cycled through for visit types
const PALETTE = ["#1e40af", "#0891b2", "#0d9488", "#65a30d", "#ca8a04", "#dc2626", "#9333ea", "#db2777", "#ea580c", "#475569"];

// Default visit schedule — users can edit, add, or remove
// type: "scheduled" (month offset from enrollment) or "unscheduled" (rate per year while active)
// followupWindow: only used for unscheduled — how many months after enrollment can it occur
const DEFAULT_VISITS = [
  { id: 1, name: "baseline", type: "scheduled", month: 0 },
  { id: 2, name: "1 month", type: "scheduled", month: 1 },
  { id: 3, name: "3 month", type: "scheduled", month: 3 },
  { id: 4, name: "6 month", type: "scheduled", month: 6 },
  { id: 5, name: "1 year", type: "scheduled", month: 12 },
  { id: 6, name: "flare", type: "unscheduled", ratePerYear: 2, followupWindow: 12 },
];

// Poisson sampler (Knuth)
function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

export default function StudyVisitModel() {
  const [participants, setParticipants] = useState(60);
  const [pace, setPace] = useState(4);
  const [visits, setVisits] = useState(DEFAULT_VISITS);
  const [dropoutAnnual, setDropoutAnnual] = useState(15); // % per year
  const [noShowRate, setNoShowRate] = useState(10); // % per visit
  const [mode, setMode] = useState("deterministic");
  const [nRuns, setNRuns] = useState(100);
  const [seed, setSeed] = useState(0); // bump to re-run stochastic

  const data = useMemo(() => {
    const enrollmentMonths = [];
    for (let i = 0; i < participants; i++) {
      enrollmentMonths.push(Math.floor(i / pace));
    }

    const scheduled = visits.filter((v) => v.type === "scheduled");
    const unscheduled = visits.filter((v) => v.type === "unscheduled");

    // Study end = last enrollment + max relevant follow-up window
    const maxScheduledMonth = scheduled.reduce((mx, v) => Math.max(mx, v.month || 0), 0);
    const maxUnschedWindow = unscheduled.reduce((mx, v) => Math.max(mx, v.followupWindow || 0), 0);
    const maxFollowup = Math.max(maxScheduledMonth, maxUnschedWindow);
    const lastMonth = (enrollmentMonths[enrollmentMonths.length - 1] || 0) + maxFollowup;
    const months = lastMonth + 1;

    const monthlyRetention = Math.pow(1 - dropoutAnnual / 100, 1 / 12);
    const showRate = 1 - noShowRate / 100;

    // Initialize buckets — one key per visit name
    const makeEmpty = () => {
      const arr = [];
      for (let m = 0; m < months; m++) {
        const obj = { month: m };
        visits.forEach((v) => { obj[v.name] = 0; });
        arr.push(obj);
      }
      return arr;
    };

    const buckets = makeEmpty();

    if (mode === "deterministic") {
      // Scheduled visits — apply retention and show rate (baseline exempt)
      enrollmentMonths.forEach((em) => {
        scheduled.forEach((v) => {
          const m = em + v.month;
          if (m >= months) return;
          if (v.month === 0) {
            buckets[m][v.name] += 1;
          } else {
            buckets[m][v.name] += Math.pow(monthlyRetention, v.month) * showRate;
          }
        });
      });

      // Unscheduled visits — rate × active retention-weighted population × show rate
      unscheduled.forEach((v) => {
        const ratePerMonth = (v.ratePerYear || 0) / 12;
        const window = v.followupWindow || 12;
        for (let m = 0; m < months; m++) {
          let activeWeighted = 0;
          enrollmentMonths.forEach((em) => {
            const monthsIn = m - em;
            if (monthsIn >= 0 && monthsIn <= window) {
              activeWeighted += Math.pow(monthlyRetention, monthsIn);
            }
          });
          buckets[m][v.name] += activeWeighted * ratePerMonth * showRate;
        }
      });

      return { buckets, months, lastMonth };
    } else {
      // Stochastic
      const totals = {};
      visits.forEach((v) => { totals[v.name] = new Array(months).fill(0); });

      for (let run = 0; run < nRuns; run++) {
        enrollmentMonths.forEach((em) => {
          // Sample dropout month (within longest follow-up window)
          let dropoutMonth = Infinity;
          for (let k = 1; k <= maxFollowup; k++) {
            if (Math.random() > monthlyRetention) {
              dropoutMonth = k;
              break;
            }
          }

          // Scheduled visits
          scheduled.forEach((v) => {
            const m = em + v.month;
            if (m >= months) return;
            if (v.month === 0) {
              totals[v.name][m] += 1;
            } else if (v.month < dropoutMonth && Math.random() < showRate) {
              totals[v.name][m] += 1;
            }
          });

          // Unscheduled visits
          unscheduled.forEach((v) => {
            const ratePerMonth = (v.ratePerYear || 0) / 12;
            const window = v.followupWindow || 12;
            for (let k = 0; k <= window; k++) {
              if (k >= dropoutMonth) break;
              const m = em + k;
              if (m >= months) break;
              const draws = poisson(ratePerMonth);
              let attended = 0;
              for (let f = 0; f < draws; f++) {
                if (Math.random() < showRate) attended++;
              }
              totals[v.name][m] += attended;
            }
          });
        });
      }

      for (let m = 0; m < months; m++) {
        visits.forEach((v) => {
          buckets[m][v.name] = totals[v.name][m] / nRuns;
        });
      }
      return { buckets, months, lastMonth };
    }
  }, [participants, pace, visits, dropoutAnnual, noShowRate, mode, nRuns, seed]);

  const stats = useMemo(() => {
    const totals = data.buckets.map((b) => {
      let total = 0;
      visits.forEach((v) => { total += b[v.name] || 0; });
      return { month: b.month, total };
    });
    const peak = totals.reduce((a, b) => (b.total > a.total ? b : a), { month: 0, total: 0 });
    const totalVisits = totals.reduce((s, x) => s + x.total, 0);
    const enrollmentEnd = Math.ceil(participants / pace) - 1;
    const steadyMonths = totals.filter((t) => t.month > enrollmentEnd && t.month <= enrollmentEnd + 6);
    const steadyAvg = steadyMonths.length
      ? steadyMonths.reduce((s, x) => s + x.total, 0) / steadyMonths.length
      : 0;

    return {
      peakVisits: peak.total,
      peakMonth: peak.month,
      totalVisits,
      duration: data.lastMonth,
      enrollmentEnd,
      steadyAvg,
    };
  }, [data, visits, participants, pace]);

  const chartData = data.buckets.map((b) => ({
    ...b,
    label: `M${b.month}`,
  }));

  return (
    <div className="p-6 max-w-6xl mx-auto bg-white">
      <h1 className="text-2xl font-bold mb-2 text-slate-900">Study Visit Modeling Tool</h1>
      <p className="text-sm text-slate-600 mb-6">
        Project monthly visit load based on enrollment, schedule, and flare rate.
      </p>

      {/* Inputs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 bg-slate-50 rounded-lg">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Participants</label>
          <input
            type="number"
            value={participants}
            onChange={(e) => setParticipants(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Enrollment / month</label>
          <input
            type="number"
            value={pace}
            onChange={(e) => setPace(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Annual dropout (%)</label>
          <input
            type="number"
            step="1"
            value={dropoutAnnual}
            onChange={(e) => setDropoutAnnual(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">No-show rate (%)</label>
          <input
            type="number"
            step="1"
            value={noShowRate}
            onChange={(e) => setNoShowRate(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white"
          >
            <option value="deterministic">Deterministic</option>
            <option value="stochastic">Stochastic (Poisson)</option>
          </select>
        </div>
        {mode === "stochastic" && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Simulation runs</label>
              <input
                type="number"
                value={nRuns}
                onChange={(e) => setNRuns(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => setSeed(seed + 1)}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
              >
                Re-run simulation
              </button>
            </div>
          </>
        )}
      </div>

      {/* Visits editor */}
      <div className="mb-6 p-4 bg-slate-50 rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-800">Visit schedule</h2>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const nextId = Math.max(0, ...visits.map((v) => v.id)) + 1;
                setVisits([...visits, { id: nextId, name: `visit ${nextId}`, type: "scheduled", month: 0 }]);
              }}
              className="px-2 py-1 text-xs bg-slate-700 text-white rounded hover:bg-slate-800"
            >
              + Scheduled
            </button>
            <button
              onClick={() => {
                const nextId = Math.max(0, ...visits.map((v) => v.id)) + 1;
                setVisits([...visits, { id: nextId, name: `event ${nextId}`, type: "unscheduled", ratePerYear: 1, followupWindow: 12 }]);
              }}
              className="px-2 py-1 text-xs bg-red-700 text-white rounded hover:bg-red-800"
            >
              + Unscheduled
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {visits.map((v, idx) => (
            <div key={v.id} className="flex items-center gap-2 text-sm">
              <div
                className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
              />
              <input
                type="text"
                value={v.name}
                onChange={(e) => {
                  const next = [...visits];
                  next[idx] = { ...v, name: e.target.value };
                  setVisits(next);
                }}
                className="px-2 py-1 border border-slate-300 rounded flex-1 min-w-0"
                placeholder="Visit name"
              />
              <select
                value={v.type}
                onChange={(e) => {
                  const next = [...visits];
                  if (e.target.value === "scheduled") {
                    next[idx] = { id: v.id, name: v.name, type: "scheduled", month: 0 };
                  } else {
                    next[idx] = { id: v.id, name: v.name, type: "unscheduled", ratePerYear: 1, followupWindow: 12 };
                  }
                  setVisits(next);
                }}
                className="px-2 py-1 border border-slate-300 rounded bg-white"
              >
                <option value="scheduled">Scheduled</option>
                <option value="unscheduled">Unscheduled</option>
              </select>
              {v.type === "scheduled" ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={v.month}
                    onChange={(e) => {
                      const next = [...visits];
                      next[idx] = { ...v, month: Math.max(0, parseInt(e.target.value) || 0) };
                      setVisits(next);
                    }}
                    className="w-16 px-2 py-1 border border-slate-300 rounded"
                  />
                  <span className="text-xs text-slate-600">mo</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.1"
                      value={v.ratePerYear}
                      onChange={(e) => {
                        const next = [...visits];
                        next[idx] = { ...v, ratePerYear: Math.max(0, parseFloat(e.target.value) || 0) };
                        setVisits(next);
                      }}
                      className="w-16 px-2 py-1 border border-slate-300 rounded"
                    />
                    <span className="text-xs text-slate-600">/yr</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={v.followupWindow}
                      onChange={(e) => {
                        const next = [...visits];
                        next[idx] = { ...v, followupWindow: Math.max(0, parseInt(e.target.value) || 0) };
                        setVisits(next);
                      }}
                      className="w-16 px-2 py-1 border border-slate-300 rounded"
                    />
                    <span className="text-xs text-slate-600">mo window</span>
                  </div>
                </>
              )}
              <button
                onClick={() => setVisits(visits.filter((x) => x.id !== v.id))}
                className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          <strong>Scheduled</strong>: occurs at a fixed month offset from enrollment (e.g. baseline = 0, 3-month = 3).
          <strong className="ml-2">Unscheduled</strong>: occurs randomly at a yearly rate during a follow-up window (e.g. flares = 2/yr over 12 months).
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Peak visits / month" value={stats.peakVisits.toFixed(1)} sub={`Month ${stats.peakMonth}`} />
        <StatCard label="Total visits" value={Math.round(stats.totalVisits)} sub="Over study lifetime" />
        <StatCard label="Study duration" value={`${stats.duration} mo`} sub={`Enrollment ends M${stats.enrollmentEnd}`} />
        <StatCard label="Steady-state load" value={stats.steadyAvg.toFixed(1)} sub="Avg visits/mo post-enrollment" />
      </div>

      {/* Chart */}
      <div className="h-96 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: "Visits", angle: -90, position: "insideLeft", style: { fontSize: 12 } }} />
            <Tooltip
              formatter={(value) => (typeof value === "number" ? value.toFixed(2) : value)}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {visits.map((v, idx) => (
              <Bar key={v.id} dataKey={v.name} stackId="a" fill={PALETTE[idx % PALETTE.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-slate-500">
        {mode === "deterministic"
          ? `Deterministic mode: scheduled visits weighted by retention probability (${dropoutAnnual}%/yr dropout) and ${100 - noShowRate}% show rate. Unscheduled events = active participants × rate × show rate.`
          : `Stochastic mode: each participant simulated independently with monthly dropout draws and per-visit no-show draws. Unscheduled events drawn from Poisson. Averaged over ${nRuns} runs.`}
      </p>
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div className="p-3 bg-white border border-slate-200 rounded-lg">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  );
}
