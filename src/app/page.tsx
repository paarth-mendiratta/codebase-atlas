"use client";

import { useState } from "react";
import CodebaseGraph, { FileNode, ImportEdge } from "@/components/CodebaseGraph";
import AuthButton from "@/components/AuthButton";

interface AnalysisResult {
  files: FileNode[];
  edges: ImportEdge[];
  truncated?: boolean;
  totalSourceFiles?: number;
  totalContentBytes?: number;
}

export default function Home() {
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [viewMode, setViewMode] = useState<"landing" | "graph">("landing");

  const isButtonDisabled = loading || !repoUrl.trim();

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isButtonDisabled) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
      });

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Server returned non-JSON response (${res.status} ${res.statusText}).`);
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Analysis failed.");
      }

      console.log("Analysis Output:", data);
      setResult(data);
      setViewMode("graph");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSavedRepo = (url: string, files: FileNode[], edges: ImportEdge[]) => {
    setRepoUrl(url);
    setResult({ files, edges });
    setViewMode("graph");
  };

  const handleBackToLanding = () => {
    setViewMode("landing");
  };

  if (viewMode === "graph" && result) {
    return (
      <CodebaseGraph
        files={result.files}
        edges={result.edges}
        repoUrl={repoUrl}
        totalContentBytes={result.totalContentBytes}
        onBack={handleBackToLanding}
        onSelectSavedRepo={handleSelectSavedRepo}
      />
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 relative selection:bg-indigo-500 selection:text-white">
      {/* Top Bar Auth Button */}
      <div className="absolute top-6 right-6 z-30">
        <AuthButton onSelectSavedRepo={handleSelectSavedRepo} />
      </div>

      <div className="w-full max-w-2xl space-y-8 text-center">
        {/* Header */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold tracking-wide uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full">
            Codebase Atlas
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
            Visualize & Explore Any Codebase
          </h1>
          <p className="text-slate-400 text-sm sm:text-base max-w-lg mx-auto">
            Paste a GitHub repository URL to generate interactive dependency maps, analyze complexity hotspots, and export pre-built context maps for AI coding agents.
          </p>
        </div>

        {/* Input Form */}
        <form onSubmit={handleAnalyze} className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center gap-3 bg-slate-900/80 p-2 rounded-2xl border border-slate-800 shadow-2xl focus-within:border-indigo-500/50 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
            <input
              type="text"
              placeholder="https://github.com/owner/repository"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              disabled={loading}
              className="w-full px-4 py-3 bg-transparent text-slate-100 placeholder-slate-500 text-sm focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isButtonDisabled}
              className={`w-full sm:w-auto px-6 py-3 font-medium text-sm rounded-xl transition-colors duration-150 flex items-center justify-center gap-2 whitespace-nowrap shadow-lg ${
                isButtonDisabled
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed shadow-none"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer shadow-indigo-600/20"
              }`}
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  <span>Analyzing...</span>
                </>
              ) : (
                <span>Analyze</span>
              )}
            </button>
          </div>
        </form>

        {/* Error Message */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium animate-in fade-in slide-in-from-top-2">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
