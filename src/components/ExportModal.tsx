"use client";

import { useState, useEffect, useMemo } from "react";
import {
  X,
  Download,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  FileCode,
  Zap,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { FileNode, ImportEdge } from "@/components/CodebaseGraph";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  repoUrl: string;
  files: FileNode[];
  edges: ImportEdge[];
  explanations: Record<string, string>;
  totalContentBytes?: number;
}

interface StaleCheckResult {
  checked: boolean;
  changedFiles: string[];
  addedFiles: string[];
  removedFiles: string[];
  isUpToDate: boolean;
}

export default function ExportModal({
  isOpen,
  onClose,
  repoUrl,
  files,
  edges,
  explanations,
  totalContentBytes = 0,
}: ExportModalProps) {
  const [overview, setOverview] = useState<string>("");
  const [loadingOverview, setLoadingOverview] = useState<boolean>(false);
  const [copiedType, setCopiedType] = useState<string | null>(null);

  // Stale check state
  const [rechecking, setRechecking] = useState<boolean>(false);
  const [staleResult, setStaleResult] = useState<StaleCheckResult>({
    checked: false,
    changedFiles: [],
    addedFiles: [],
    removedFiles: [],
    isUpToDate: true,
  });

  const repoName = useMemo(() => {
    try {
      const parts = new URL(repoUrl).pathname.split("/").filter(Boolean);
      return parts.slice(0, 2).join("/");
    } catch {
      return "repository";
    }
  }, [repoUrl]);

  // Fetch AI overview when modal opens
  useEffect(() => {
    if (isOpen && !overview && !loadingOverview) {
      setLoadingOverview(true);
      fetch("/api/export-overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, files, edges, explanations }),
      })
        .then((res) => res.json())
        .then((data) => {
          setOverview(data.overview || "Architecture overview generated.");
        })
        .catch(() => {
          setOverview("Architecture overview generated for this repository.");
        })
        .finally(() => {
          setLoadingOverview(false);
        });
    }
  }, [isOpen, overview, loadingOverview, repoUrl, files, edges, explanations]);

  // Generate Dependency Map grouped by source
  const dependencyMapStr = useMemo(() => {
    const map = new Map<string, string[]>();
    edges.forEach((e) => {
      if (!map.has(e.source)) map.set(e.source, []);
      map.get(e.source)!.push(e.target);
    });

    if (map.size === 0) return "No direct relative import relationships detected.";

    const lines: string[] = [];
    map.forEach((targets, source) => {
      lines.push(`- \`${source}\` imports:`);
      targets.forEach((t) => lines.push(`  - \`${t}\``));
    });

    return lines.join("\n");
  }, [edges]);

  // Compute file complexity scores
  const complexityMap = useMemo(() => {
    const inDegreeMap = new Map<string, number>();
    const outDegreeMap = new Map<string, number>();

    edges.forEach((e) => {
      outDegreeMap.set(e.source, (outDegreeMap.get(e.source) || 0) + 1);
      inDegreeMap.set(e.target, (inDegreeMap.get(e.target) || 0) + 1);
    });

    const rawScores = new Map<string, number>();
    files.forEach((f) => {
      const inDeg = inDegreeMap.get(f.path) || 0;
      const outDeg = outDegreeMap.get(f.path) || 0;
      const sizeFactor = Math.log2(f.size / 100 + 1);
      const degreeFactor = inDeg * 2.5 + outDeg * 1.5;
      rawScores.set(f.path, sizeFactor * 2 + degreeFactor * 5);
    });

    let minRaw = Infinity;
    let maxRaw = -Infinity;
    rawScores.forEach((v) => {
      if (v < minRaw) minRaw = v;
      if (v > maxRaw) maxRaw = v;
    });

    if (minRaw === maxRaw) {
      minRaw = 0;
      maxRaw = Math.max(1, maxRaw);
    }

    const resultMap = new Map<string, { score: number; isHotspot: boolean }>();
    const sortedRaw = Array.from(rawScores.values()).sort((a, b) => b - a);
    const hotspotThresholdRaw = sortedRaw[Math.max(0, Math.floor(sortedRaw.length * 0.2) - 1)] ?? 75;

    files.forEach((f) => {
      const raw = rawScores.get(f.path) || 0;
      const score = Math.min(100, Math.max(5, Math.round(((raw - minRaw) / (maxRaw - minRaw)) * 95 + 5)));
      resultMap.set(f.path, { score, isHotspot: raw >= hotspotThresholdRaw && raw > 5 });
    });

    return resultMap;
  }, [files, edges]);

  // Generate full CODEMAP.md content
  const codemapContent = useMemo(() => {
    const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);

    const fileRows = files
      .map((f) => {
        const exp = explanations[f.path] || `Source ${f.type} file (${f.size} bytes).`;
        const cleanedExp = exp.replace(/[\r\n]+/g, " ");
        const meta = complexityMap.get(f.path) || { score: 10, isHotspot: false };
        const scoreBadge = meta.isHotspot ? `🔥 ${meta.score}/100 (Hotspot)` : `${meta.score}/100`;
        return `| \`${f.path}\` | ${cleanedExp} | ${scoreBadge} | ${f.size} bytes |`;
      })
      .join("\n");

    const hotspotsList = Array.from(complexityMap.entries())
      .filter(([, meta]) => meta.isHotspot)
      .map(([path, meta]) => `- \`${path}\` — Complexity: ${meta.score}/100`)
      .join("\n");

    return `# Codebase Atlas Map: ${repoName}

## Architecture Overview
${overview || "Generating overview..."}

${
  hotspotsList
    ? `## High-Complexity Hotspots\nFiles requiring careful modification due to high connection count or size:\n${hotspotsList}\n`
    : ""
}
## File Map
| Path | Purpose / Role | Complexity | Size |
| :--- | :--- | :--- | :--- |
${fileRows}

## Dependency Graph
${dependencyMapStr}

---
*Generated by Codebase Atlas on ${timestamp} UTC*
`;
  }, [repoName, overview, files, explanations, dependencyMapStr, complexityMap]);

  // Token savings calculations
  const { fullRepoTokens, mapTokens, tokenReductionPercent } = useMemo(() => {
    const totalBytes = totalContentBytes > 0 ? totalContentBytes : files.reduce((acc, f) => acc + f.size, 0);
    const fullTokens = Math.max(1, Math.round(totalBytes / 4));
    const mapToks = Math.max(1, Math.round(codemapContent.length / 4));

    const reduction = Math.max(0, Math.round(((fullTokens - mapToks) / fullTokens) * 100));

    return {
      fullRepoTokens: fullTokens,
      mapTokens: mapToks,
      tokenReductionPercent: reduction,
    };
  }, [totalContentBytes, files, codemapContent]);

  // Copy helper
  const handleCopy = (type: "raw" | "claude" | "cursor" | "general") => {
    let textToCopy = codemapContent;

    if (type === "claude") {
      textToCopy = `# Project Context\nThe following is a pre-generated architecture map of this codebase. Use it as context instead of re-reading files from scratch.\n\n${codemapContent}`;
    } else if (type === "cursor") {
      textToCopy = `<!-- Cursor Context -->\nUse this architecture map as codebase context for code generation.\n\n${codemapContent}`;
    } else if (type === "general") {
      textToCopy = `The following document provides the pre-analyzed architecture map and file dependency structure for this codebase.\n\n${codemapContent}`;
    }

    navigator.clipboard.writeText(textToCopy);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  // Download CODEMAP.md file
  const handleDownload = () => {
    const blob = new Blob([codemapContent], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "CODEMAP.md");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Re-check stale files
  const handleRecheckStale = async () => {
    setRechecking(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });

      if (res.ok) {
        const data = await res.json();
        const currentFiles: FileNode[] = data.files || [];

        const currentMap = new Map<string, FileNode>();
        currentFiles.forEach((f) => currentMap.set(f.path, f));

        const originalMap = new Map<string, FileNode>();
        files.forEach((f) => originalMap.set(f.path, f));

        const changed: string[] = [];
        const added: string[] = [];
        const removed: string[] = [];

        currentFiles.forEach((f) => {
          const orig = originalMap.get(f.path);
          if (!orig) {
            added.push(f.path);
          } else if (orig.sha !== f.sha || orig.size !== f.size) {
            changed.push(f.path);
          }
        });

        files.forEach((f) => {
          if (!currentMap.has(f.path)) {
            removed.push(f.path);
          }
        });

        const isUpToDate = changed.length === 0 && added.length === 0 && removed.length === 0;

        setStaleResult({
          checked: true,
          changedFiles: changed,
          addedFiles: added,
          removedFiles: removed,
          isUpToDate,
        });
      }
    } catch {
      // Ignore network errors
    } finally {
      setRechecking(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Export Architecture Map</h2>
              <p className="text-xs text-slate-400 font-mono">CODEMAP.md for {repoName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Token Savings Highlight Banner */}
          <div className="p-4 bg-gradient-to-r from-indigo-950/60 via-slate-900 to-indigo-950/40 border border-indigo-500/30 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-400">
                <Zap className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                <span>Token Efficiency Savings</span>
              </div>
              <p className="text-sm text-slate-200">
                Full repo scan:{" "}
                <span className="font-mono text-slate-400">~{fullRepoTokens.toLocaleString()} tokens</span>{" "}
                → This map:{" "}
                <span className="font-mono text-emerald-400 font-semibold">
                  ~{mapTokens.toLocaleString()} tokens
                </span>
              </p>
            </div>

            <div className="px-4 py-2 bg-indigo-500/20 border border-indigo-500/40 rounded-xl text-center self-start sm:self-auto">
              <span className="text-xl font-extrabold text-indigo-300">
                {tokenReductionPercent}% Token Reduction
              </span>
            </div>
          </div>

          {/* Quick Copy Buttons for Coding Agents */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Copy Pre-Framed for AI Coding Agents:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => handleCopy("claude")}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 transition-colors flex items-center justify-between gap-2 cursor-pointer"
              >
                <span>Copy for Claude Code</span>
                {copiedType === "claude" ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              <button
                onClick={() => handleCopy("cursor")}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 transition-colors flex items-center justify-between gap-2 cursor-pointer"
              >
                <span>Copy for Cursor</span>
                {copiedType === "cursor" ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              <button
                onClick={() => handleCopy("general")}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 transition-colors flex items-center justify-between gap-2 cursor-pointer"
              >
                <span>Copy for General Agent</span>
                {copiedType === "general" ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>
            </div>
          </div>

          {/* Stale Check Bar */}
          <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${rechecking ? "animate-spin" : ""}`} />
              <span className="text-slate-300 font-medium">Incremental Change Sync:</span>
              {!staleResult.checked && (
                <span className="text-slate-500">Not verified against live repo yet</span>
              )}
              {staleResult.checked && staleResult.isUpToDate && (
                <span className="text-emerald-400 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> All files up to date!
                </span>
              )}
              {staleResult.checked && !staleResult.isUpToDate && (
                <span className="text-amber-400 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {staleResult.changedFiles.length} modified, {staleResult.addedFiles.length} added
                </span>
              )}
            </div>

            <button
              onClick={handleRecheckStale}
              disabled={rechecking}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors text-xs font-medium disabled:opacity-50 cursor-pointer"
            >
              {rechecking ? "Checking..." : "Re-check for changes"}
            </button>
          </div>

          {/* Document Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                CODEMAP.md Preview
              </span>
              {loadingOverview && (
                <span className="text-xs text-indigo-400 animate-pulse flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Generating architecture overview...
                </span>
              )}
            </div>
            <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto max-h-64 whitespace-pre-wrap leading-relaxed select-text">
              {codemapContent}
            </pre>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-900/80">
          <button
            onClick={() => handleCopy("raw")}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 transition-colors flex items-center gap-2 cursor-pointer"
          >
            {copiedType === "raw" ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Copied Raw MD</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-slate-400" />
                <span>Copy Raw MD</span>
              </>
            )}
          </button>

          <button
            onClick={handleDownload}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-xl transition-colors shadow-lg shadow-indigo-600/20 flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Download CODEMAP.md</span>
          </button>
        </div>
      </div>
    </div>
  );
}
