import React, { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";

// Color palette cycled through for visit types
const PALETTE = ["#1e40af", "#0891b2", "#0d9488", "#65a30d", "#ca8a04", "#dc2626", "#9333ea", "#db2777", "#ea580c", "#475569"];

// Sample type palette — distinct from visit palette
const SAMPLE_PALETTE = ["#be185d", "#7c3aed", "#0369a1", "#065f46", "#92400e", "#1e3a5f", "#4a1942", "#134e4a"];

const FREEZER_TIERS = [
  { id: "-80", label: "−80°C" },
  { id: "-20", label: "−20°C" },
  { id: "4",   label: "4°C" },
  { id: "RT",  label: "Room temp" },
];

// Default visit schedule
const DEFAULT_VISITS = [
  { id: 1, name: "baseline",  type: "scheduled",   month: 0  },
  { id: 2, name: "1 month",   type: "scheduled",   month: 1  },
  { id: 3, name: "3 month",   type: "scheduled",   month: 3  },
  { id: 4, name: "6 month",   type: "scheduled",   month: 6  },
  { id: 5, name: "1 year",    type: "scheduled",   month: 12 },
  { id: 6, name: "flare",     type: "unscheduled", ratePerYear: 2, followupWindow: 12 },
];

// Default sample types
const DEFAULT_SAMPLE_TYPES = [
  { id: 1, name: "Serum",  tier: "-80", boxCapacity: 81 },
  { id: 2, name: "PBMC",   tier: "-80", boxCapacity: 81 },
  { id: 3, name: "Urine",  tier: "-20", boxCapacity: 81 },
];

// Default collection matrix: sampleTypeId -> visitId -> aliquot count
const DEFAULT_COLLECTION = {
  1: { 1: 4, 2: 2, 3: 2, 4: 2, 5: 4, 6: 1 }, // Serum
  2: { 1: 2, 5: 2 },                            // PBMC: baseline + 1yr only
  3: { 1: 2, 3: 2, 4: 2, 5: 2 },               // Urine: no flare
};

// Poisson sampler (Knuth)
function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

export default function StudyVisitModel() {
  // Core study state
  const [studyName,     setStudyName]     = useState("");
  const [participants,  setParticipants]  = useState(60);
  const [pace,          setPace]          = useState(4);
  const [visits,        setVisits]        = useState(DEFAULT_VISITS);
  const [dropoutAnnual, setDropoutAnnual] = useState(15);
  const [noShowRate,    setNoShowRate]    = useState(10);
  const [mode,          setMode]          = useState("deterministic");
  const [nRuns,         setNRuns]         = useState(100);
  const [seed,          setSeed]          = useState(0);

  // Sample storage state
  const [sampleTypes, setSampleTypes] = useState(DEFAULT_SAMPLE_TYPES);
  const [collection,  setCollection]  = useState(DEFAULT_COLLECTION);
  const [storageOpen, setStorageOpen] = useState(false);

  // Visit load model (unchanged logic)
  const data = useMemo(() => {
    const enrollmentMonths = [];
    for (let i = 0; i < participants; i++) enrollmentMonths.push(Math.floor(i / pace));

    const scheduled   = visits.filter((v) => v.type === "scheduled");
    const unscheduled = visits.filter((v) => v.type === "unscheduled");

    const maxScheduledMonth = scheduled.reduce((mx, v) => Math.max(mx, v.month || 0), 0);
    const maxUnschedWindow  = unscheduled.reduce((mx, v) => Math.max(mx, v.followupWindow || 0), 0);
    const maxFollowup = Math.max(maxScheduledMonth, maxUnschedWindow);
    const lastMonth   = (enrollmentMonths[enrollmentMonths.length - 1] || 0) + maxFollowup;
    const months      = lastMonth + 1;

    const monthlyRetention = Math.pow(1 - dropoutAnnual / 100, 1 / 12);
    const showRate         = 1 - noShowRate / 100;

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
      enrollmentMonths.forEach((em) => {
        scheduled.forEach((v) => {
          const m = em + v.month;
          if (m >= months) return;
          buckets[m][v.name] += v.month === 0 ? 1 : Math.pow(monthlyRetention, v.month) * showRate;
        });
      });
      unscheduled.forEach((v) => {
        const ratePerMonth = (v.ratePerYear || 0) / 12;
        const win = v.followupWindow || 12;
        for (let m = 0; m < months; m++) {
          let aw = 0;
          enrollmentMonths.forEach((em) => {
            const mi = m - em;
            if (mi >= 0 && mi <= win) aw += Math.pow(monthlyRetention, mi);
          });
          buckets[m][v.name] += aw * ratePerMonth * showRate;
        }
      });
      return { buckets, months, lastMonth };
    } else {
      const totals = {};
      visits.forEach((v) => { totals[v.name] = new Array(months).fill(0); });
      for (let run = 0; run < nRuns; run++) {
        enrollmentMonths.forEach((em) => {
          let dropoutMonth = Infinity;
          for (let k = 1; k <= maxFollowup; k++) {
            if (Math.random() > monthlyRetention) { dropoutMonth = k; break; }
          }
          scheduled.forEach((v) => {
            const m = em + v.month;
            if (m >= months) return;
            if (v.month === 0) totals[v.name][m] += 1;
            else if (v.month < dropoutMonth && Math.random() < showRate) totals[v.name][m] += 1;
          });
          unscheduled.forEach((v) => {
            const ratePerMonth = (v.ratePerYear || 0) / 12;
            const win = v.followupWindow || 12;
            for (let k = 0; k <= win; k++) {
              if (k >= dropoutMonth) break;
              const m = em + k;
              if (m >= months) break;
              const draws = poisson(ratePerMonth);
              let attended = 0;
              for (let f = 0; f < draws; f++) if (Math.random() < showRate) attended++;
              totals[v.name][m] += attended;
            }
          });
        });
      }
      for (let m = 0; m < months; m++) {
        visits.forEach((v) => { buckets[m][v.name] = totals[v.name][m] / nRuns; });
      }
      return { buckets, months, lastMonth };
    }
  }, [participants, pace, visits, dropoutAnnual, noShowRate, mode, nRuns, seed]);

  // Visit load stats
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
      ? steadyMonths.reduce((s, x) => s + x.total, 0) / steadyMonths.length : 0;
    return { peakVisits: peak.total, peakMonth: peak.month, totalVisits, duration: data.lastMonth, enrollmentEnd, steadyAvg };
  }, [data, visits, participants, pace]);

  // Sample storage model
  const storageData = useMemo(() => {
    if (sampleTypes.length === 0) return { cumulative: [], peakByTier: {}, totalAliquots: {} };

    const { buckets, months } = data;

    // Monthly new aliquots per sample type
    const monthly = Array.from({ length: months }, (_, m) => {
      const obj = { month: m };
      sampleTypes.forEach((st) => {
        let newAliquots = 0;
        visits.forEach((v) => {
          const aliquotsPerVisit = collection[st.id]?.[v.id] ?? 0;
          if (aliquotsPerVisit > 0) newAliquots += (buckets[m][v.name] || 0) * aliquotsPerVisit;
        });
        obj[`new_${st.id}`] = newAliquots;
      });
      return obj;
    });

    // Running cumulative totals
    const running = {};
    sampleTypes.forEach((st) => { running[st.id] = 0; });

    const cumulative = monthly.map((row) => {
      const obj = { month: row.month, label: `M${row.month}` };
      sampleTypes.forEach((st) => {
        running[st.id] += row[`new_${st.id}`];
        obj[`aliquots_${st.id}`] = running[st.id];
        obj[`boxes_${st.id}`]    = running[st.id] / (st.boxCapacity || 81);
      });
      FREEZER_TIERS.forEach((tier) => {
        const tierTypes = sampleTypes.filter((st) => st.tier === tier.id);
        obj[`tier_${tier.id}`] = tierTypes.reduce((s, st) => s + (obj[`boxes_${st.id}`] || 0), 0);
      });
      return obj;
    });

    const peakByTier = {};
    FREEZER_TIERS.forEach((tier) => {
      peakByTier[tier.id] = Math.max(0, ...cumulative.map((r) => r[`tier_${tier.id}`] || 0));
    });

    const totalAliquots = {};
    sampleTypes.forEach((st) => { totalAliquots[st.id] = running[st.id]; });

    return { cumulative, peakByTier, totalAliquots };
  }, [data, sampleTypes, visits, collection]);

  const chartData = data.buckets.map((b) => ({ ...b, label: `M${b.month}` }));

  // Sample type helpers
  const addSampleType = () => {
    const nextId = Math.max(0, ...sampleTypes.map((s) => s.id)) + 1;
    setSampleTypes([...sampleTypes, { id: nextId, name: `Sample ${nextId}`, tier: "-80", boxCapacity: 81 }]);
  };

  const updateSampleType = (id, field, value) => {
    setSampleTypes(sampleTypes.map((s) => s.id === id ? { ...s, [field]: value } : s));
  };

  const removeSampleType = (id) => {
    setSampleTypes(sampleTypes.filter((s) => s.id !== id));
    setCollection((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const setAliquots = (sampleTypeId, visitId, value) => {
    const n = Math.max(0, parseInt(value) || 0);
    setCollection((prev) => ({
      ...prev,
      [sampleTypeId]: { ...(prev[sampleTypeId] || {}), [visitId]: n },
    }));
  };

  const activeTiers = FREEZER_TIERS.filter((tier) => sampleTypes.some((st) => st.tier === tier.id));

  return (
    <div className="p-6 max-w-6xl mx-auto bg-white">
      <h1 className="text-2xl font-bold mb-2 text-slate-900">
        Study Visit Modeling Tool{studyName ? `: ${studyName}` : ""}
      </h1>
      <p className="text-sm text-slate-600 mb-6">
        Project monthly visit load based on enrollment, schedule, and flare rate.
      </p>

      {/* Inputs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 bg-slate-50 rounded-lg">
        <div className="col-span-2 md:col-span-4">
          <label className="block text-xs font-medium text-slate-700 mb-1">Study name</label>
          <input type="text" value={studyName} onChange={(e) => setStudyName(e.target.value)}
            placeholder="e.g. AURORA Phase 2 — 60pt scenario"
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Participants</label>
          <input type="number" value={participants}
            onChange={(e) => setParticipants(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Enrollment / month</label>
          <input type="number" value={pace}
            onChange={(e) => setPace(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Annual dropout (%)</label>
          <input type="number" step="1" value={dropoutAnnual}
            onChange={(e) => setDropoutAnnual(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">No-show rate (%)</label>
          <input type="number" step="1" value={noShowRate}
            onChange={(e) => setNoShowRate(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white">
            <option value="deterministic">Deterministic</option>
            <option value="stochastic">Stochastic (Poisson)</option>
          </select>
        </div>
        {mode === "stochastic" && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Simulation runs</label>
              <input type="number" value={nRuns}
                onChange={(e) => setNRuns(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
            </div>
            <div className="flex items-end">
              <button onClick={() => setSeed(seed + 1)}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
                Re-run simulation
              </button>
            </div>
          </>
        )}
      </div>

      {/* Visit schedule editor */}
      <div className="mb-6 p-4 bg-slate-50 rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-800">Visit schedule</h2>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const nextId = Math.max(0, ...visits.map((v) => v.id)) + 1;
                setVisits([...visits, { id: nextId, name: `visit ${nextId}`, type: "scheduled", month: 0 }]);
              }}
              className="px-2 py-1 text-xs bg-slate-700 text-white rounded hover:bg-slate-800">
              + Scheduled
            </button>
            <button
              onClick={() => {
                const nextId = Math.max(0, ...visits.map((v) => v.id)) + 1;
                setVisits([...visits, { id: nextId, name: `event ${nextId}`, type: "unscheduled", ratePerYear: 1, followupWindow: 12 }]);
              }}
              className="px-2 py-1 text-xs bg-red-700 text-white rounded hover:bg-red-800">
              + Unscheduled
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {visits.map((v, idx) => (
            <div key={v.id} className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ backgroundColor: PALETTE[idx % PALETTE.length] }} />
              <input type="text" value={v.name}
                onChange={(e) => {
                  const next = [...visits]; next[idx] = { ...v, name: e.target.value }; setVisits(next);
                }}
                className="px-2 py-1 border border-slate-300 rounded flex-1 min-w-0" placeholder="Visit name" />
              <select value={v.type}
                onChange={(e) => {
                  const next = [...visits];
                  next[idx] = e.target.value === "scheduled"
                    ? { id: v.id, name: v.name, type: "scheduled", month: 0 }
                    : { id: v.id, name: v.name, type: "unscheduled", ratePerYear: 1, followupWindow: 12 };
                  setVisits(next);
                }}
                className="px-2 py-1 border border-slate-300 rounded bg-white">
                <option value="scheduled">Scheduled</option>
                <option value="unscheduled">Unscheduled</option>
              </select>
              {v.type === "scheduled" ? (
                <div className="flex items-center gap-1">
                  <input type="number" value={v.month}
                    onChange={(e) => {
                      const next = [...visits]; next[idx] = { ...v, month: Math.max(0, parseInt(e.target.value) || 0) }; setVisits(next);
                    }}
                    className="w-16 px-2 py-1 border border-slate-300 rounded" />
                  <span className="text-xs text-slate-600">mo</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1">
                    <input type="number" step="0.1" value={v.ratePerYear}
                      onChange={(e) => {
                        const next = [...visits]; next[idx] = { ...v, ratePerYear: Math.max(0, parseFloat(e.target.value) || 0) }; setVisits(next);
                      }}
                      className="w-16 px-2 py-1 border border-slate-300 rounded" />
                    <span className="text-xs text-slate-600">/yr</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input type="number" value={v.followupWindow}
                      onChange={(e) => {
                        const next = [...visits]; next[idx] = { ...v, followupWindow: Math.max(0, parseInt(e.target.value) || 0) }; setVisits(next);
                      }}
                      className="w-16 px-2 py-1 border border-slate-300 rounded" />
                    <span className="text-xs text-slate-600">mo window</span>
                  </div>
                </>
              )}
              <button onClick={() => setVisits(visits.filter((x) => x.id !== v.id))}
                className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded" title="Remove">✕</button>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          <strong>Scheduled</strong>: occurs at a fixed month offset from enrollment.{" "}
          <strong>Unscheduled</strong>: occurs randomly at a yearly rate during a follow-up window.
        </p>
      </div>

      {/* Visit load stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Peak visits / month" value={stats.peakVisits.toFixed(1)} sub={`Month ${stats.peakMonth}`} />
        <StatCard label="Total visits" value={Math.round(stats.totalVisits)} sub="Over study lifetime" />
        <StatCard label="Study duration" value={`${stats.duration} mo`} sub={`Enrollment ends M${stats.enrollmentEnd}`} />
        <StatCard label="Steady-state load" value={stats.steadyAvg.toFixed(1)} sub="Avg visits/mo post-enrollment" />
      </div>

      {/* Visit load chart */}
      <div className="h-72 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: "Visits", angle: -90, position: "insideLeft", style: { fontSize: 12 } }} />
            <Tooltip formatter={(v) => (typeof v === "number" ? v.toFixed(2) : v)} contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {visits.map((v, idx) => (
              <Bar key={v.id} dataKey={v.name} stackId="a" fill={PALETTE[idx % PALETTE.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-slate-500 mb-8">
        {mode === "deterministic"
          ? `Deterministic mode: scheduled visits weighted by retention probability (${dropoutAnnual}%/yr dropout) and ${100 - noShowRate}% show rate. Unscheduled events = active participants × rate × show rate.`
          : `Stochastic mode: each participant simulated independently with monthly dropout draws and per-visit no-show draws. Unscheduled events drawn from Poisson. Averaged over ${nRuns} runs.`}
      </p>

      {/* ═══════════════════════════════════════════════
          SAMPLE STORAGE MODULE
      ═══════════════════════════════════════════════ */}
      <div className="border border-slate-200 rounded-lg overflow-hidden mb-6">

        {/* Collapsible header */}
        <button
          onClick={() => setStorageOpen(!storageOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 hover:bg-slate-200 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-800">🧊 Sample Storage Projection</span>
            {!storageOpen && activeTiers.length > 0 && (
              <span className="text-xs text-slate-500">
                {activeTiers
                  .map((t) => {
                    const peak = storageData.peakByTier[t.id];
                    return peak > 0.01 ? `${t.label}: ${peak.toFixed(1)} boxes` : null;
                  })
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
          <span className="text-slate-400 text-xs">{storageOpen ? "▲ collapse" : "▼ expand"}</span>
        </button>

        {storageOpen && (
          <div className="p-5 space-y-6">

            {/* Sample type registry */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-800">Sample types</h3>
                <button onClick={addSampleType}
                  className="px-2 py-1 text-xs bg-slate-700 text-white rounded hover:bg-slate-800">
                  + Add sample type
                </button>
              </div>
              {sampleTypes.length === 0 && (
                <p className="text-sm text-slate-400 py-2">No sample types defined.</p>
              )}
              <div className="space-y-2">
                {sampleTypes.map((st, idx) => (
                  <div key={st.id} className="flex items-center gap-2 text-sm flex-wrap">
                    <div className="w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: SAMPLE_PALETTE[idx % SAMPLE_PALETTE.length] }} />
                    <input type="text" value={st.name}
                      onChange={(e) => updateSampleType(st.id, "name", e.target.value)}
                      className="px-2 py-1 border border-slate-300 rounded w-28 text-sm"
                      placeholder="Sample name" />
                    <select value={st.tier}
                      onChange={(e) => updateSampleType(st.id, "tier", e.target.value)}
                      className="px-2 py-1 border border-slate-300 rounded bg-white text-sm">
                      {FREEZER_TIERS.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <input type="number" value={st.boxCapacity}
                        onChange={(e) => updateSampleType(st.id, "boxCapacity", Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 px-2 py-1 border border-slate-300 rounded text-sm" />
                      <span className="text-xs text-slate-500">slots/box</span>
                    </div>
                    {storageData.totalAliquots[st.id] != null && storageData.totalAliquots[st.id] > 0 && (
                      <span className="text-xs text-slate-400">
                        {Math.round(storageData.totalAliquots[st.id])} aliquots total ·{" "}
                        {(storageData.totalAliquots[st.id] / st.boxCapacity).toFixed(1)} boxes
                      </span>
                    )}
                    <button onClick={() => removeSampleType(st.id)}
                      className="ml-auto px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded">✕</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Collection matrix */}
            {sampleTypes.length > 0 && visits.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-800 mb-1">Aliquots collected per visit</h3>
                <p className="text-xs text-slate-500 mb-3">
                  Number of aliquots collected for each sample type at each visit. For unscheduled visits, this is aliquots per occurrence.
                </p>
                <div className="overflow-x-auto">
                  <table className="text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left text-xs font-medium text-slate-600 pb-2 pr-6 whitespace-nowrap">Sample type</th>
                        {visits.map((v, idx) => (
                          <th key={v.id} className="text-center text-xs font-medium pb-2 px-2">
                            <div className="flex flex-col items-center gap-1">
                              <div className="w-2 h-2 rounded-sm"
                                style={{ backgroundColor: PALETTE[idx % PALETTE.length] }} />
                              <span className="text-slate-600 whitespace-nowrap">{v.name}</span>
                              {v.type === "unscheduled" && (
                                <span className="text-slate-400 font-normal text-xs">per event</span>
                              )}
                            </div>
                          </th>
                        ))}
                        <th className="text-center text-xs font-medium text-slate-500 pb-2 pl-4 whitespace-nowrap">Total aliquots</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sampleTypes.map((st, sidx) => (
                        <tr key={st.id} className="border-t border-slate-100">
                          <td className="py-2 pr-6">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-sm flex-shrink-0"
                                style={{ backgroundColor: SAMPLE_PALETTE[sidx % SAMPLE_PALETTE.length] }} />
                              <span className="font-medium text-slate-700 whitespace-nowrap">{st.name}</span>
                            </div>
                          </td>
                          {visits.map((v) => (
                            <td key={v.id} className="py-2 px-2 text-center">
                              <input
                                type="number"
                                min="0"
                                value={collection[st.id]?.[v.id] ?? 0}
                                onChange={(e) => setAliquots(st.id, v.id, e.target.value)}
                                className="w-14 px-1 py-1 border border-slate-200 rounded text-center text-sm"
                              />
                            </td>
                          ))}
                          <td className="py-2 pl-4 text-center text-xs text-slate-500 whitespace-nowrap">
                            {storageData.totalAliquots[st.id] != null
                              ? Math.round(storageData.totalAliquots[st.id]).toLocaleString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Storage stats + charts */}
            {activeTiers.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Peak storage requirements</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  {activeTiers.map((tier, idx) => {
                    const peak = storageData.peakByTier[tier.id] || 0;
                    const tierTypes = sampleTypes.filter((st) => st.tier === tier.id);
                    const breakdown = tierTypes
                      .map((st) => {
                        const boxes = (storageData.totalAliquots[st.id] || 0) / (st.boxCapacity || 81);
                        return `${st.name}: ${boxes.toFixed(1)}`;
                      })
                      .join(", ");
                    return (
                      <StatCard
                        key={tier.id}
                        label={`${tier.label} boxes`}
                        value={peak.toFixed(1)}
                        sub={breakdown || "—"}
                      />
                    );
                  })}
                  <StatCard
                    label="Total aliquots"
                    value={Math.round(
                      Object.values(storageData.totalAliquots).reduce((s, x) => s + x, 0)
                    ).toLocaleString()}
                    sub="Across all sample types"
                  />
                </div>

                {/* Chart: cumulative boxes by freezer tier */}
                <h3 className="text-sm font-semibold text-slate-800 mb-2">Cumulative storage by freezer tier</h3>
                <div className="h-60 mb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={storageData.cumulative}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} label={{ value: "Boxes", angle: -90, position: "insideLeft", style: { fontSize: 12 } }} />
                      <Tooltip formatter={(v, name) => [`${v.toFixed(1)} boxes`, name]} contentStyle={{ fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {activeTiers.map((tier, idx) => (
                        <Area key={tier.id} type="monotone"
                          dataKey={`tier_${tier.id}`} name={tier.label}
                          stackId="tiers"
                          stroke={SAMPLE_PALETTE[idx % SAMPLE_PALETTE.length]}
                          fill={SAMPLE_PALETTE[idx % SAMPLE_PALETTE.length]}
                          fillOpacity={0.45} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Chart: cumulative boxes by sample type */}
                <h3 className="text-sm font-semibold text-slate-800 mb-2">Cumulative storage by sample type</h3>
                <div className="h-60 mb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={storageData.cumulative}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} label={{ value: "Boxes", angle: -90, position: "insideLeft", style: { fontSize: 12 } }} />
                      <Tooltip formatter={(v, name) => [`${v.toFixed(1)} boxes`, name]} contentStyle={{ fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {sampleTypes.map((st, idx) => (
                        <Area key={st.id} type="monotone"
                          dataKey={`boxes_${st.id}`}
                          name={`${st.name} (${FREEZER_TIERS.find((t) => t.id === st.tier)?.label})`}
                          stackId="samples"
                          stroke={SAMPLE_PALETTE[idx % SAMPLE_PALETTE.length]}
                          fill={SAMPLE_PALETTE[idx % SAMPLE_PALETTE.length]}
                          fillOpacity={0.45} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <p className="text-xs text-slate-500">
                  Storage accumulates over the full study duration — no samples are assumed to be discarded early.
                  Box counts are fractional in charts; round up for actual freezer procurement.
                  Attrition and no-show rates from the visit model flow through automatically.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
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
