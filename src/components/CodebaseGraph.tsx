"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { forceCollide } from "d3-force";
import {
  X,
  Sparkles,
  FileText,
  ArrowLeft,
  Send,
  MessageSquare,
  Download,
  Flame,
  Activity,
} from "lucide-react";
import ExportModal from "./ExportModal";
import AuthButton from "./AuthButton";

// Dynamically import ForceGraph2D with SSR disabled
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

export interface FileNode {
  path: string;
  size: number;
  type: string;
  sha?: string;
}

export interface ImportEdge {
  source: string;
  target: string;
}

interface GraphNode {
  id: string;
  filename: string;
  path: string;
  size: number;
  type: string;
  color: string;
  val: number;
  complexityScore: number;
  complexityReason: string;
  isHotspot: boolean;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface CodebaseGraphProps {
  files: FileNode[];
  edges: ImportEdge[];
  repoUrl: string;
  totalContentBytes?: number;
  onBack: () => void;
  onSelectSavedRepo?: (repoUrl: string, files: FileNode[], edges: ImportEdge[]) => void;
}

function getNodeColor(filePath: string, ext: string): string {
  const p = filePath.toLowerCase();
  if (p.includes("test") || p.includes("spec") || p.includes("__tests__")) return "#f59e0b"; // Amber
  if (p.includes("component") || p.includes("/ui/") || p.includes("view")) return "#ec4899"; // Pink
  if (p.includes("api") || p.includes("route") || p.includes("server")) return "#3b82f6"; // Blue
  if (p.includes("type") || p.includes("interface") || p.includes("model")) return "#8b5cf6"; // Purple
  if (ext === "md" || p.includes("doc")) return "#10b981"; // Emerald
  if (ext === "css" || ext === "html") return "#06b6d4"; // Cyan
  if (ext === "py" || ext === "go" || ext === "java" || ext === "rb") return "#f97316"; // Orange
  return "#6366f1"; // Indigo default
}

export default function CodebaseGraph({
  files,
  edges,
  repoUrl,
  totalContentBytes,
  onBack,
  onSelectSavedRepo,
}: CodebaseGraphProps) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [explaining, setExplaining] = useState(false);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [showHotspots, setShowHotspots] = useState(true);

  // ForceGraph reference
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);

  // Chat state
  const [question, setQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    { role: "user" | "assistant"; text: string; files?: string[] }[]
  >([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Compute graph data
  const graphData = useMemo(() => {
    const nodeSet = new Set<string>();
    files.forEach((f) => nodeSet.add(f.path));
    edges.forEach((e) => {
      nodeSet.add(e.source);
      nodeSet.add(e.target);
    });

    const fileMap = new Map<string, FileNode>();
    files.forEach((f) => fileMap.set(f.path, f));

    const inDegreeMap = new Map<string, number>();
    const outDegreeMap = new Map<string, number>();

    edges.forEach((e) => {
      outDegreeMap.set(e.source, (outDegreeMap.get(e.source) || 0) + 1);
      inDegreeMap.set(e.target, (inDegreeMap.get(e.target) || 0) + 1);
    });

    const rawScores = new Map<string, number>();
    const allPaths = Array.from(nodeSet);

    allPaths.forEach((p) => {
      const f = fileMap.get(p);
      const size = f?.size || 100;
      const inDeg = inDegreeMap.get(p) || 0;
      const outDeg = outDegreeMap.get(p) || 0;

      const sizeFactor = Math.log2(size / 100 + 1);
      const degreeFactor = inDeg * 2.5 + outDeg * 1.5;
      const raw = sizeFactor * 2 + degreeFactor * 5;

      rawScores.set(p, raw);
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

    const sortedRaw = Array.from(rawScores.values()).sort((a, b) => b - a);
    const hotspotThresholdIndex = Math.max(0, Math.floor(sortedRaw.length * 0.2) - 1);
    const hotspotThresholdRaw = sortedRaw[hotspotThresholdIndex] ?? 75;

    const nodes: GraphNode[] = allPaths.map((p) => {
      const filename = p.split("/").pop() || p;
      const f = fileMap.get(p);
      const ext = p.split(".").pop() || "";
      const raw = rawScores.get(p) || 0;

      const normalizedScore = Math.min(
        100,
        Math.max(5, Math.round(((raw - minRaw) / (maxRaw - minRaw)) * 95 + 5))
      );

      const inDeg = inDegreeMap.get(p) || 0;
      const outDeg = outDegreeMap.get(p) || 0;
      const isHotspot = raw >= hotspotThresholdRaw && raw > 5;

      const reasons: string[] = [];
      if (inDeg > 0) reasons.push(`imported by ${inDeg} files`);
      if (outDeg > 0) reasons.push(`imports ${outDeg} modules`);
      if ((f?.size || 0) > 2000) reasons.push(`large file size (${Math.round((f?.size || 0) / 1024)} KB)`);
      if (reasons.length === 0) reasons.push("standard source module");

      const complexityReason = reasons.join(", ");

      const defaultVal = Math.max(4, Math.min(12, Math.log2(((f?.size || 500) / 100) + 1) * 3));
      const complexityVal = Math.max(5, Math.min(18, (normalizedScore / 100) * 14 + 5));

      return {
        id: p,
        filename,
        path: p,
        size: f?.size || 100,
        type: f?.type || ext,
        color: getNodeColor(p, ext),
        val: showHotspots ? complexityVal : defaultVal,
        complexityScore: normalizedScore,
        complexityReason,
        isHotspot,
      };
    });

    const links: GraphLink[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    return { nodes, links };
  }, [files, edges, showHotspots]);

  // Adjust physics forces on graph engine
  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force("charge")?.strength(-350);
      fgRef.current.d3Force("link")?.distance(100);
      // Add collision force based on node size
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fgRef.current.d3Force("collide", forceCollide((node: any) => node.val * 1.3 + 15));
      fgRef.current.d3ReheatSimulation();
    }
  }, [graphData]);

  const neighborsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    edges.forEach((e) => {
      if (!map.has(e.source)) map.set(e.source, new Set());
      if (!map.has(e.target)) map.set(e.target, new Set());
      map.get(e.source)!.add(e.target);
      map.get(e.target)!.add(e.source);
    });
    return map;
  }, [edges]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      setSelectedNode(node);

      const highlights = new Set<string>();
      highlights.add(node.id);

      const neighbors = neighborsMap.get(node.id);
      if (neighbors) {
        neighbors.forEach((nbr) => highlights.add(nbr));
      }

      setHighlightedNodes(highlights);

      if (!explanations[node.path]) {
        setExplaining(true);
        fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: node.path, repoUrl }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.explanation) {
              setExplanations((prev) => ({ ...prev, [node.path]: data.explanation }));
            } else {
              setExplanations((prev) => ({
                ...prev,
                [node.path]: data.error || "Could not generate explanation.",
              }));
            }
          })
          .catch(() => {
            setExplanations((prev) => ({
              ...prev,
              [node.path]: "Network error generating explanation.",
            }));
          })
          .finally(() => {
            setExplaining(false);
          });
      }
    },
    [neighborsMap, explanations, repoUrl]
  );

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || chatLoading) return;

    const q = question.trim();
    setQuestion("");
    setChatHistory((prev) => [...prev, { role: "user", text: q }]);
    setChatLoading(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, files, edges }),
      });
      const data = await res.json();

      if (res.ok) {
        setChatHistory((prev) => [
          ...prev,
          { role: "assistant", text: data.answer, files: data.relevantFiles },
        ]);

        if (Array.isArray(data.relevantFiles) && data.relevantFiles.length > 0) {
          const highlights = new Set<string>();
          data.relevantFiles.forEach((path: string) => {
            highlights.add(path);
            const nbrs = neighborsMap.get(path);
            if (nbrs) nbrs.forEach((nbr) => highlights.add(nbr));
          });
          setHighlightedNodes(highlights);
        }
      } else {
        setChatHistory((prev) => [
          ...prev,
          { role: "assistant", text: data.error || "Failed to process question." },
        ]);
      }
    } catch {
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", text: "Error connecting to assistant." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const clearSelection = () => {
    setSelectedNode(null);
    setHighlightedNodes(new Set());
  };

  return (
    <div className="relative w-full h-screen bg-slate-950 overflow-hidden flex flex-col select-none">
      {/* Top Navbar */}
      <header className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-4 bg-slate-900/80 backdrop-blur-md border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Analyze Another Repo</span>
          </button>
          <div className="h-4 w-px bg-slate-800 hidden sm:block" />
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
            <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-slate-300">
              {files.length} files
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-slate-300">
              {edges.length} imports
            </span>
          </div>
        </div>

        {/* Hotspot Toggle + Export + Auth */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHotspots((prev) => !prev)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
              showHotspots
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-md shadow-amber-500/10"
                : "bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            <Flame className={`w-3.5 h-3.5 ${showHotspots ? "text-amber-400 fill-amber-400/20" : ""}`} />
            <span>{showHotspots ? "Hotspots: ON" : "Hotspots: OFF"}</span>
          </button>

          <button
            onClick={() => setIsExportOpen(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl transition-colors shadow-lg shadow-indigo-600/20 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>Export Map</span>
          </button>

          <AuthButton onSelectSavedRepo={onSelectSavedRepo} />
        </div>
      </header>

      {/* Main Canvas Area */}
      <div ref={containerRef} className="w-full h-full">
        {dimensions.width > 0 && (
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            onEngineStop={() => {
              if (fgRef.current) {
                fgRef.current.zoomToFit(400, 100);
              }
            }}
            nodeLabel={(node: unknown) => {
              const n = node as GraphNode;
              return `${n.path} (${n.size} bytes) • Complexity: ${n.complexityScore}/100`;
            }}
            nodeColor={(node: unknown) => (node as GraphNode).color}
            nodeVal={(node: unknown) => (node as GraphNode).val}
            linkDirectionalArrowLength={5}
            linkDirectionalArrowRelPos={1}
            linkColor={() => "rgba(148, 163, 184, 0.3)"}
            linkWidth={1.5}
            onNodeClick={(node: unknown) => handleNodeClick(node as GraphNode)}
            onBackgroundClick={clearSelection}
            nodeCanvasObject={(node: unknown, ctx, globalScale) => {
              const n = node as GraphNode;
              const isHighlighted =
                highlightedNodes.size === 0 || highlightedNodes.has(n.id);

              const radius = n.val * 0.6;
              const fontSize = Math.max(10 / globalScale, 3.5);
              ctx.font = `${fontSize}px Sans-Serif`;

              ctx.globalAlpha = isHighlighted ? 1.0 : 0.15;

              ctx.beginPath();
              ctx.arc(n.x || 0, n.y || 0, radius, 0, 2 * Math.PI, false);
              ctx.fillStyle = n.color;
              ctx.fill();

              if (showHotspots && n.isHotspot) {
                ctx.strokeStyle = "#f59e0b";
                ctx.lineWidth = 2.5 / globalScale;
                ctx.setLineDash([3 / globalScale, 2 / globalScale]);
                ctx.beginPath();
                ctx.arc(n.x || 0, n.y || 0, radius + 3.5 / globalScale, 0, 2 * Math.PI, false);
                ctx.stroke();
                ctx.setLineDash([]);
              }

              if (selectedNode?.id === n.id) {
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2.5 / globalScale;
                ctx.beginPath();
                ctx.arc(n.x || 0, n.y || 0, radius + 1.5 / globalScale, 0, 2 * Math.PI, false);
                ctx.stroke();
              }

              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillStyle = isHighlighted ? "#f8fafc" : "#64748b";
              ctx.fillText(n.filename, n.x || 0, (n.y || 0) + radius + fontSize + 2);

              ctx.globalAlpha = 1.0;
            }}
          />
        )}
      </div>

      {/* Hotspot Legend Key Overlay */}
      {showHotspots && (
        <div className="absolute top-20 left-6 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-3 z-10 text-xs text-slate-300 space-y-2 max-w-xs shadow-xl pointer-events-none">
          <div className="flex items-center gap-1.5 font-bold text-amber-400">
            <Activity className="w-3.5 h-3.5" />
            <span>Complexity & Hotspots Key</span>
          </div>
          <div className="space-y-1 text-[11px] text-slate-400">
            <p className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-slate-600 border border-amber-400 border-dashed shrink-0" />
              <span>Dashed ring = High Risk / Hotspot node</span>
            </p>
            <p className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-indigo-500 shrink-0" />
              <span>Node size = Weighted complexity score</span>
            </p>
          </div>
        </div>
      )}

      {/* Side Panel (Node Explanation + Complexity Readout) */}
      {selectedNode && (
        <aside className="absolute top-20 right-6 w-96 max-w-[calc(100vw-3rem)] bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-6 z-30 space-y-4 animate-in fade-in slide-in-from-right-4">
          <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="space-y-1 pr-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <h3 className="font-semibold text-slate-100 truncate text-sm">
                  {selectedNode.filename}
                </h3>
              </div>
              <p className="text-xs text-slate-400 font-mono break-all">{selectedNode.path}</p>
            </div>
            <button
              onClick={clearSelection}
              className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Size: {selectedNode.size} bytes</span>
            <span className="uppercase px-2 py-0.5 rounded bg-slate-800 font-mono text-slate-300">
              {selectedNode.type}
            </span>
          </div>

          <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                Complexity Score:
              </span>
              <span
                className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                  selectedNode.complexityScore >= 75
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : "bg-slate-800 text-slate-300"
                }`}
              >
                {selectedNode.complexityScore} / 100
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              {selectedNode.complexityReason}
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-400">
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI File Overview</span>
            </div>

            {explaining ? (
              <div className="flex items-center gap-3 p-4 bg-slate-950/60 rounded-xl border border-slate-800/60 text-xs text-slate-400 animate-pulse">
                <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                <span>Generating Gemini explanation...</span>
              </div>
            ) : (
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800/60 text-xs text-slate-300 leading-relaxed">
                {explanations[selectedNode.path] || "No explanation generated."}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Floating Chat Panel at Bottom */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-30">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
          {chatHistory.length > 0 && (
            <div className="p-4 border-b border-slate-800/80 max-h-48 overflow-y-auto space-y-3 text-xs">
              {chatHistory.slice(-2).map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex gap-2 ${
                    msg.role === "user" ? "text-indigo-300 font-medium" : "text-slate-200"
                  }`}
                >
                  <span className="font-semibold text-slate-400 shrink-0">
                    {msg.role === "user" ? "You:" : "Atlas:"}
                  </span>
                  <div>
                    <p>{msg.text}</p>
                    {msg.files && msg.files.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <span className="text-slate-400">Highlighted nodes:</span>
                        {msg.files.map((f) => (
                          <span
                            key={f}
                            className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 rounded font-mono text-[10px]"
                          >
                            {f.split("/").pop()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAsk} className="p-2 flex items-center gap-2">
            <div className="pl-3 text-slate-500">
              <MessageSquare className="w-4 h-4" />
            </div>
            <input
              type="text"
              placeholder="Ask a question about this codebase (e.g. where do tests live?)..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={chatLoading}
              className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 px-2 py-2.5 focus:outline-none"
            />
            <button
              type="submit"
              disabled={chatLoading || !question.trim()}
              className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white rounded-xl transition-colors shadow-md disabled:cursor-not-allowed"
            >
              {chatLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        repoUrl={repoUrl}
        files={files}
        edges={edges}
        explanations={explanations}
        totalContentBytes={totalContentBytes}
      />
    </div>
  );
}
