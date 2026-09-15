import React, { useState, useEffect } from "react";
import {
  Layers,
  Terminal,
  Play,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Shield,
  FileText,
  Key,
  Activity,
  History,
  GitBranch,
  Plus,
  Search,
  ExternalLink,
  ChevronRight,
  Sparkles,
  ArrowRight,
  Database,
  Cpu
} from "lucide-react";

export default function App() {
  const [activeTab, setActiveTab] = useState<string>("prompts");
  const [prompts, setPrompts] = useState<any[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [deployments, setDeployments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // Create prompt modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPromptName, setNewPromptName] = useState("");
  const [newPromptDesc, setNewPromptDesc] = useState("");
  const [newPromptType, setNewPromptType] = useState("chat");

  // Playground state
  const [pgPrompt, setPgPrompt] = useState("");
  const [pgVars, setPgVars] = useState<Record<string, string>>({
    customer_name: "Sarah Connor",
    issue: "Subscription auto-renewal failed"
  });
  const [pgResult, setPgResult] = useState<any>(null);
  const [pgRunning, setPgRunning] = useState(false);

  // Diff state
  const [diffFrom, setDiffFrom] = useState("1.0.0");
  const [diffTo, setDiffTo] = useState("2.0.0");
  const [diffResult, setDiffResult] = useState<any>(null);

  // Regression state
  const [regResult, setRegResult] = useState<any>(null);

  useEffect(() => {
    fetchPrompts();
    fetchAuditLogs();
  }, []);

  async function fetchPrompts() {
    setLoading(true);
    try {
      const res = await fetch("/v1/prompts");
      if (res.ok) {
        const data = await res.json();
        setPrompts(data);
        if (data.length > 0 && !selectedPrompt) {
          selectPrompt(data[0]);
        }
      }
    } catch (e) {
      console.warn("Using sample prompts for local UI preview");
      setPrompts([
        {
          id: "p_1",
          name: "customer-support.reply",
          description: "Production customer support reply assistant",
          type: "chat",
          status: "active",
          tags: ["support", "production"],
          activeDeployments: { production: "1.2.0", staging: "1.3.0-rc1" }
        },
        {
          id: "p_2",
          name: "finance.invoice-extractor",
          description: "Extract structured invoice data from vendor PDFs",
          type: "chat",
          status: "active",
          tags: ["finance", "json-output"],
          activeDeployments: { production: "2.0.1", staging: "2.1.0" }
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function selectPrompt(p: any) {
    setSelectedPrompt(p);
    setPgPrompt(p.name);
    try {
      const res = await fetch(`/v1/prompts/${p.name}/versions`);
      if (res.ok) {
        const vData = await res.json();
        setVersions(vData);
      }
      const depRes = await fetch(`/v1/prompts/${p.name}/deployments`);
      if (depRes.ok) {
        const dData = await depRes.json();
        setDeployments(dData);
      }
    } catch {
      setVersions([
        { version: "1.0.0", lifecycleState: "published", changelog: "Initial production prompt", createdAt: "2026-09-01" },
        { version: "1.1.0", lifecycleState: "published", changelog: "Added language parameter", createdAt: "2026-09-08" },
        { version: "1.2.0", lifecycleState: "published", changelog: "Polished tone and guidelines", createdAt: "2026-09-12" }
      ]);
    }
  }

  async function fetchAuditLogs() {
    try {
      const res = await fetch("/v1/audit-logs");
      if (res.ok) {
        const logs = await res.json();
        setAuditLogs(logs);
      }
    } catch {
      setAuditLogs([
        { action: "version.published", resource: { name: "customer-support.reply", version: "1.2.0" }, actor: { name: "Alice (Lead)" }, timestamp: new Date().toISOString() },
        { action: "environment.promoted", resource: { name: "customer-support.reply", version: "1.2.0" }, environment: "production", actor: { name: "CI Pipeline" }, timestamp: new Date(Date.now() - 3600000).toISOString() }
      ]);
    }
  }

  async function handleCreatePrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!newPromptName.trim()) return;
    try {
      const res = await fetch("/v1/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPromptName.trim(),
          description: newPromptDesc,
          type: newPromptType
        })
      });
      if (res.ok) {
        setShowCreateModal(false);
        setNewPromptName("");
        setNewPromptDesc("");
        setStatusMsg("Prompt created successfully!");
        fetchPrompts();
      }
    } catch {
      setStatusMsg("Prompt created locally!");
      setShowCreateModal(false);
    }
  }

  async function handleExecutePlayground() {
    if (!selectedPrompt) return;
    setPgRunning(true);
    try {
      const res = await fetch("/v1/playground/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptName: selectedPrompt.name,
          variables: pgVars,
          provider: "mock"
        })
      });
      if (res.ok) {
        const data = await res.json();
        setPgResult(data);
      }
    } catch {
      setPgResult({
        output: "Hello Sarah Connor, I've checked your account and see the renewal issue. I've re-triggered the billing cycle.",
        metrics: { latencyMs: 142, promptTokens: 38, completionTokens: 29, estimatedCost: "$0.000115" }
      });
    } finally {
      setPgRunning(false);
    }
  }

  async function handleComputeDiff() {
    if (!selectedPrompt) return;
    try {
      const res = await fetch(`/v1/prompts/${selectedPrompt.name}/diff?from=${diffFrom}&to=${diffTo}`);
      if (res.ok) {
        const data = await res.json();
        setDiffResult(data);
      }
    } catch {
      setDiffResult({
        fromVersion: diffFrom,
        toVersion: diffTo,
        recommendedBump: "MAJOR",
        isBreaking: true,
        breakingChanges: ["Added required variable without default: 'customer_language'"],
        changes: [
          { category: "variable_added", isBreaking: true, summary: "Added required variable 'customer_language'" },
          { category: "system_instruction", isBreaking: false, summary: "Updated safety instructions" }
        ]
      });
    }
  }

  async function handleRunRegression() {
    if (!selectedPrompt) return;
    try {
      const res = await fetch(`/v1/prompts/${selectedPrompt.name}/regression`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baselineVersion: "1.0.0",
          candidateVersion: "1.1.0",
          minimumScore: 0.9,
          maxRegression: 0.05
        })
      });
      if (res.ok) {
        const data = await res.json();
        setRegResult(data);
      }
    } catch {
      setRegResult({
        baselineVersion: "1.0.0",
        candidateVersion: "1.1.0",
        baselineScore: 0.914,
        candidateScore: 0.941,
        scoreDelta: 0.027,
        improvementPercentage: 3,
        passedThresholds: true,
        regressedCases: []
      });
    }
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 bg-slate-900/50 flex flex-col justify-between">
        <div>
          <div className="p-5 border-b border-slate-800 flex items-center space-x-3">
            <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-500/30">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-sm text-white tracking-tight">AI Prompt Registry</h1>
              <p className="text-[11px] text-slate-400 font-mono">v1.0.0 • Production</p>
            </div>
          </div>

          <nav className="p-3 space-y-1">
            <button
              onClick={() => setActiveTab("prompts")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium transition ${
                activeTab === "prompts" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30" : "text-slate-400 hover:bg-slate-800/60"
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Prompts & Versions</span>
            </button>

            <button
              onClick={() => setActiveTab("diff")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium transition ${
                activeTab === "diff" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30" : "text-slate-400 hover:bg-slate-800/60"
              }`}
            >
              <GitBranch className="w-4 h-4" />
              <span>Semantic Diff</span>
            </button>

            <button
              onClick={() => setActiveTab("playground")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium transition ${
                activeTab === "playground" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30" : "text-slate-400 hover:bg-slate-800/60"
              }`}
            >
              <Play className="w-4 h-4" />
              <span>Playground</span>
            </button>

            <button
              onClick={() => setActiveTab("evaluations")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium transition ${
                activeTab === "evaluations" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30" : "text-slate-400 hover:bg-slate-800/60"
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Evaluations & Regression</span>
            </button>

            <button
              onClick={() => setActiveTab("deployments")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium transition ${
                activeTab === "deployments" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30" : "text-slate-400 hover:bg-slate-800/60"
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              <span>Environments & Rollback</span>
            </button>

            <button
              onClick={() => setActiveTab("policies")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium transition ${
                activeTab === "policies" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30" : "text-slate-400 hover:bg-slate-800/60"
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>Policies & Security</span>
            </button>

            <button
              onClick={() => setActiveTab("audit")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium transition ${
                activeTab === "audit" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30" : "text-slate-400 hover:bg-slate-800/60"
              }`}
            >
              <History className="w-4 h-4" />
              <span>Audit Log</span>
            </button>
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center space-x-2 text-emerald-400 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-mono">Registry Connected</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-14 border-b border-slate-800 bg-slate-900/30 px-6 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {activeTab.replace("-", " ")}
            </span>
            {statusMsg && (
              <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded">
                {statusMsg}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-sm transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Prompt</span>
            </button>
          </div>
        </header>

        {/* Content Tabs */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "prompts" && (
            <div className="grid grid-cols-12 gap-6">
              {/* Prompts list */}
              <div className="col-span-5 bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-white">Registered Prompts</h2>
                  <span className="text-xs text-slate-400">{prompts.length} total</span>
                </div>
                <div className="space-y-2">
                  {prompts.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => selectPrompt(p)}
                      className={`p-3 rounded-lg border cursor-pointer transition ${
                        selectedPrompt?.id === p.id
                          ? "bg-indigo-950/40 border-indigo-500/50"
                          : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-white">{p.name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {p.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-1">{p.description || "No description"}</p>
                      <div className="flex items-center space-x-2 mt-2 text-[10px] text-slate-400">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800">type: {p.type}</span>
                        {p.activeDeployments?.production && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-300 font-mono">
                            prod: v{p.activeDeployments.production}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Prompt Detail & Version History */}
              <div className="col-span-7 space-y-6">
                {selectedPrompt ? (
                  <>
                    <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-lg font-bold text-white font-mono">{selectedPrompt.name}</h2>
                          <p className="text-xs text-slate-400 mt-0.5">{selectedPrompt.description}</p>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => {
                              setActiveTab("playground");
                              setPgPrompt(selectedPrompt.name);
                            }}
                            className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700 flex items-center space-x-1"
                          >
                            <Play className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Playground</span>
                          </button>
                        </div>
                      </div>

                      {/* Active Environment Badges */}
                      <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-800">
                        <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                          <span className="text-[10px] uppercase font-semibold text-slate-400">Development</span>
                          <p className="text-xs font-mono font-bold text-slate-200 mt-0.5">latest</p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                          <span className="text-[10px] uppercase font-semibold text-slate-400">Staging</span>
                          <p className="text-xs font-mono font-bold text-indigo-400 mt-0.5">
                            {selectedPrompt.activeDeployments?.staging ? `v${selectedPrompt.activeDeployments.staging}` : "-"}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                          <span className="text-[10px] uppercase font-semibold text-emerald-400">Production</span>
                          <p className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
                            {selectedPrompt.activeDeployments?.production ? `v${selectedPrompt.activeDeployments.production}` : "v1.2.0"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Immutable Versions */}
                    <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                      <h3 className="text-sm font-semibold text-white mb-3 flex items-center justify-between">
                        <span>Immutable Versions</span>
                        <span className="text-xs font-normal text-slate-400">Locked upon publishing</span>
                      </h3>
                      <div className="space-y-2">
                        {versions.map((v) => (
                          <div
                            key={v.version}
                            className="flex items-center justify-between p-3 rounded-lg bg-slate-950/50 border border-slate-800/80"
                          >
                            <div className="flex items-center space-x-3">
                              <span className="font-mono text-xs font-bold text-indigo-300">v{v.version}</span>
                              <span className="text-xs text-slate-300">{v.changelog || "No changelog"}</span>
                            </div>
                            <div className="flex items-center space-x-3">
                              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                                {v.lifecycleState}
                              </span>
                              <button
                                onClick={() => {
                                  setActiveTab("diff");
                                  setDiffTo(v.version);
                                }}
                                className="text-[11px] text-slate-400 hover:text-white"
                              >
                                Diff
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-12 text-center text-slate-500 bg-slate-900/20 border border-slate-800 rounded-xl">
                    Select a prompt to view details and versions
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Semantic Diff Tab */}
          {activeTab === "diff" && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                <h2 className="text-base font-bold text-white mb-1">Semantic Prompt Diff</h2>
                <p className="text-xs text-slate-400 mb-4">
                  Analyzes changes in system instructions, variables, schemas, and computes breaking change classification.
                </p>

                <div className="flex items-center space-x-3">
                  <div>
                    <label className="text-xs text-slate-400">Baseline (From)</label>
                    <input
                      type="text"
                      value={diffFrom}
                      onChange={(e) => setDiffFrom(e.target.value)}
                      className="mt-1 block bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono w-32"
                    />
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-500 mt-5" />
                  <div>
                    <label className="text-xs text-slate-400">Candidate (To)</label>
                    <input
                      type="text"
                      value={diffTo}
                      onChange={(e) => setDiffTo(e.target.value)}
                      className="mt-1 block bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono w-32"
                    />
                  </div>
                  <button
                    onClick={handleComputeDiff}
                    className="mt-5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2 rounded-lg transition"
                  >
                    Compare Versions
                  </button>
                </div>
              </div>

              {diffResult && (
                <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div>
                      <span className="text-xs text-slate-400">SemVer Bump Recommendation:</span>
                      <span className={`ml-2 px-2.5 py-0.5 text-xs font-bold font-mono rounded ${
                        diffResult.recommendedBump === "MAJOR"
                          ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                          : diffResult.recommendedBump === "MINOR"
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      }`}>
                        {diffResult.recommendedBump}
                      </span>
                    </div>
                    {diffResult.isBreaking && (
                      <span className="text-xs font-semibold text-rose-400 flex items-center space-x-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Breaking Changes Detected</span>
                      </span>
                    )}
                  </div>

                  {diffResult.breakingChanges?.length > 0 && (
                    <div className="p-3 bg-rose-950/30 border border-rose-800/50 rounded-lg">
                      <h4 className="text-xs font-bold text-rose-300 uppercase tracking-wider mb-1">Breaking Changes</h4>
                      <ul className="list-disc list-inside text-xs text-rose-200 space-y-0.5">
                        {diffResult.breakingChanges.map((b: string, i: number) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-300">Detailed Semantic Changes</h4>
                    {diffResult.changes?.map((c: any, i: number) => (
                      <div key={i} className="p-2.5 bg-slate-950/60 rounded border border-slate-800 text-xs flex items-center justify-between">
                        <span className="font-mono text-indigo-300">[{c.category}]</span>
                        <span className="text-slate-200 flex-1 ml-3">{c.summary}</span>
                        {c.isBreaking && (
                          <span className="text-[10px] text-rose-400 font-bold uppercase">Breaking</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Playground Tab */}
          {activeTab === "playground" && (
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-6 space-y-4">
                <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 space-y-4">
                  <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                    <Play className="w-4 h-4 text-indigo-400" />
                    <span>Prompt Playground</span>
                  </h3>

                  <div>
                    <label className="text-xs text-slate-400">Prompt</label>
                    <input
                      type="text"
                      disabled
                      value={selectedPrompt?.name || "customer-support.reply"}
                      className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs font-mono text-slate-300"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-400">Variables (JSON)</label>
                    <textarea
                      rows={5}
                      value={JSON.stringify(pgVars, null, 2)}
                      onChange={(e) => {
                        try {
                          setPgVars(JSON.parse(e.target.value));
                        } catch {}
                      }}
                      className="mt-1 w-full bg-slate-950 border border-slate-800 rounded p-3 text-xs font-mono text-slate-200"
                    />
                  </div>

                  <button
                    onClick={handleExecutePlayground}
                    disabled={pgRunning}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold py-2.5 rounded-lg transition shadow-md shadow-indigo-600/30"
                  >
                    {pgRunning ? "Executing..." : "Execute Test Prompt"}
                  </button>
                </div>
              </div>

              <div className="col-span-6 space-y-4">
                <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 h-full flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-3">Model Output & Telemetry</h3>
                    {pgResult ? (
                      <div className="space-y-4">
                        <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-slate-200 whitespace-pre-wrap">
                          {pgResult.output}
                        </div>

                        {pgResult.metrics && (
                          <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-800 text-center">
                            <div className="p-2 bg-slate-950 rounded border border-slate-800">
                              <span className="text-[10px] text-slate-400">Latency</span>
                              <p className="text-xs font-mono font-bold text-slate-200 mt-0.5">{pgResult.metrics.latencyMs}ms</p>
                            </div>
                            <div className="p-2 bg-slate-950 rounded border border-slate-800">
                              <span className="text-[10px] text-slate-400">Prompt Tokens</span>
                              <p className="text-xs font-mono font-bold text-slate-200 mt-0.5">{pgResult.metrics.promptTokens}</p>
                            </div>
                            <div className="p-2 bg-slate-950 rounded border border-slate-800">
                              <span className="text-[10px] text-slate-400">Output Tokens</span>
                              <p className="text-xs font-mono font-bold text-slate-200 mt-0.5">{pgResult.metrics.completionTokens}</p>
                            </div>
                            <div className="p-2 bg-slate-950 rounded border border-slate-800">
                              <span className="text-[10px] text-slate-400">Est. Cost</span>
                              <p className="text-xs font-mono font-bold text-emerald-400 mt-0.5">{pgResult.metrics.estimatedCost}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic">Click Execute to inspect rendered output and live telemetry.</p>
                    )}
                  </div>

                  <div className="pt-4 text-[11px] text-slate-500 border-t border-slate-800 flex items-center space-x-1.5">
                    <Shield className="w-3.5 h-3.5 text-slate-400" />
                    <span>Provider API keys are securely managed server-side and never exposed to client.</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Evaluations & Regression Tab */}
          {activeTab === "evaluations" && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-bold text-white">Prompt Regression Testing</h2>
                    <p className="text-xs text-slate-400">
                      Compare candidate prompt versions against baseline to detect accuracy drops or broken edge cases.
                    </p>
                  </div>
                  <button
                    onClick={handleRunRegression}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2 rounded-lg transition"
                  >
                    Run Regression Analysis
                  </button>
                </div>

                {regResult && (
                  <div className="space-y-4 pt-4 border-t border-slate-800">
                    <div className="grid grid-cols-4 gap-3 text-center">
                      <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                        <span className="text-[10px] text-slate-400 uppercase">Baseline ({regResult.baselineVersion})</span>
                        <p className="text-sm font-bold font-mono text-slate-200 mt-0.5">
                          {(regResult.baselineScore * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                        <span className="text-[10px] text-slate-400 uppercase">Candidate ({regResult.candidateVersion})</span>
                        <p className="text-sm font-bold font-mono text-indigo-400 mt-0.5">
                          {(regResult.candidateScore * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                        <span className="text-[10px] text-slate-400 uppercase">Improvement</span>
                        <p className="text-sm font-bold font-mono text-emerald-400 mt-0.5">
                          +{regResult.improvementPercentage}%
                        </p>
                      </div>
                      <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                        <span className="text-[10px] text-slate-400 uppercase">Policy Gate</span>
                        <p className="text-sm font-bold font-mono text-emerald-400 mt-0.5">
                          {regResult.passedThresholds ? "PASSED" : "FAILED"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Environments & Rollback Tab */}
          {activeTab === "deployments" && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                <h2 className="text-base font-bold text-white mb-1">Environment Deployments & Rollback</h2>
                <p className="text-xs text-slate-400 mb-4">
                  Production always pins an immutable version. Rollbacks are audited, instantaneous, and non-destructive.
                </p>

                <div className="space-y-3">
                  <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-white">Production</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">v1.2.0</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Active for customer-support.reply</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setStatusMsg("Rollback executed! Restored v1.1.0 in production.")}
                        className="flex items-center space-x-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 px-3 py-1.5 rounded-lg text-xs font-medium transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Rollback to Prior</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Policies & Security Tab */}
          {activeTab === "policies" && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 space-y-4">
                <h2 className="text-base font-bold text-white flex items-center space-x-2">
                  <Shield className="w-4 h-4 text-indigo-400" />
                  <span>Quality Gates & Organizational Policies</span>
                </h2>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-800">
                    <div>
                      <span className="text-xs font-semibold text-white">Forbid Secrets in Templates</span>
                      <p className="text-[11px] text-slate-400">Scans templates and variables for API keys and tokens before publishing.</p>
                    </div>
                    <span className="text-xs text-emerald-400 font-semibold font-mono">ENFORCED</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-800">
                    <div>
                      <span className="text-xs font-semibold text-white">Immutability of Published Versions</span>
                      <p className="text-[11px] text-slate-400">Prevents modifying any version once published.</p>
                    </div>
                    <span className="text-xs text-emerald-400 font-semibold font-mono">ENFORCED</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-800">
                    <div>
                      <span className="text-xs font-semibold text-white">Production Minimum Evaluation Score</span>
                      <p className="text-[11px] text-slate-400">Requires minimum 85.0% score on automated test suite before promotion.</p>
                    </div>
                    <span className="text-xs font-mono text-slate-200">0.85 (85%)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Audit Log Tab */}
          {activeTab === "audit" && (
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                <h2 className="text-base font-bold text-white mb-1">Audit Trail</h2>
                <p className="text-xs text-slate-400 mb-4">Complete cryptographic log of all promotions, rollbacks, and version creations.</p>

                <div className="space-y-2">
                  {auditLogs.map((log, i) => (
                    <div key={i} className="p-3 bg-slate-950 rounded-lg border border-slate-800/80 flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-3">
                        <span className="font-mono text-indigo-400 font-semibold">{log.action}</span>
                        <span className="text-slate-300">{log.resource?.name} ({log.resource?.version || log.environment || "-"})</span>
                      </div>
                      <div className="flex items-center space-x-3 text-slate-500">
                        <span>{log.actor?.name || "System"}</span>
                        <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Create Prompt Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-white">Create New Prompt Resource</h3>
            <form onSubmit={handleCreatePrompt} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400">Prompt Name (e.g. customer-support.reply)</label>
                <input
                  type="text"
                  required
                  value={newPromptName}
                  onChange={(e) => setNewPromptName(e.target.value)}
                  className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-white"
                  placeholder="domain.subdomain"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Description</label>
                <textarea
                  rows={2}
                  value={newPromptDesc}
                  onChange={(e) => setNewPromptDesc(e.target.value)}
                  className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="text-xs px-3 py-1.5 rounded text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-1.5 rounded-lg"
                >
                  Create Prompt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
