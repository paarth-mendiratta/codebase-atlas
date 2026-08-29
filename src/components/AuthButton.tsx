"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState, useEffect, useRef } from "react";
import { LogOut, History, ChevronDown, Check, Zap } from "lucide-react";
import { FileNode, ImportEdge } from "@/components/CodebaseGraph";

interface SavedAnalysis {
  id: number;
  repoUrl: string;
  createdAt: string;
  files: FileNode[];
  edges: ImportEdge[];
}

interface AuthButtonProps {
  onSelectSavedRepo?: (repoUrl: string, files: FileNode[], edges: ImportEdge[]) => void;
}

export default function AuthButton({ onSelectSavedRepo }: AuthButtonProps) {
  const { data: session } = useSession();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SavedAnalysis[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setHistoryOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (session?.user && historyOpen) {
      setLoadingHistory(true);
      fetch("/api/history")
        .then((res) => res.json())
        .then((data) => {
          if (data.analyses) {
            setHistory(data.analyses);
          }
        })
        .catch(() => {
          setHistory([]);
        })
        .finally(() => {
          setLoadingHistory(false);
        });
    }
  }, [session, historyOpen]);

  const handleSignInClick = () => {
    try {
      signIn("github");
    } catch {
      // Fallback
    }
  };

  if (!session || !session.user) {
    return (
      <button
        onClick={handleSignInClick}
        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition-colors flex items-center gap-2 shadow-md cursor-pointer select-none"
      >
        <svg className="w-3.5 h-3.5 fill-current text-slate-300" viewBox="0 0 24 24">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
        </svg>
        <span>Sign in with GitHub</span>
      </button>
    );
  }

  const user = session.user;

  return (
    <div ref={containerRef} className="relative flex items-center gap-2 z-40">
      {/* My Repos Button */}
      <div className="relative">
        <button
          onClick={() => {
            setHistoryOpen((prev) => !prev);
            setDropdownOpen(false);
          }}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 transition-colors flex items-center gap-1.5 shadow-md cursor-pointer"
        >
          <History className="w-3.5 h-3.5 text-indigo-400" />
          <span>My Repos</span>
          <ChevronDown className="w-3 h-3 text-slate-400" />
        </button>

        {/* History Dropdown Menu */}
        {historyOpen && (
          <div className="absolute right-0 mt-2 w-72 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Recent Analyses
              </span>
              <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                <Zap className="w-3 h-3" /> Instant Cache
              </span>
            </div>

            <div className="max-h-60 overflow-y-auto py-1 space-y-1">
              {loadingHistory ? (
                <div className="p-4 text-center text-xs text-slate-500 animate-pulse">
                  Loading history...
                </div>
              ) : history.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  No saved repo analyses yet.
                </div>
              ) : (
                history.map((item) => {
                  const name = item.repoUrl.replace("https://github.com/", "");
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setHistoryOpen(false);
                        if (onSelectSavedRepo) {
                          onSelectSavedRepo(item.repoUrl, item.files, item.edges);
                        }
                      }}
                      className="w-full text-left p-2.5 hover:bg-slate-800/80 rounded-xl transition-colors flex items-center justify-between group cursor-pointer"
                    >
                      <div className="space-y-0.5 truncate pr-2">
                        <p className="text-xs font-medium text-slate-200 group-hover:text-indigo-300 truncate">
                          {name}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {item.files.length} files • {item.edges.length} imports
                        </p>
                      </div>
                      <Check className="w-3.5 h-3.5 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* User Profile Avatar */}
      <div className="relative">
        <button
          onClick={() => {
            setDropdownOpen((prev) => !prev);
            setHistoryOpen(false);
          }}
          className="flex items-center gap-2 p-1 bg-slate-800/80 hover:bg-slate-700/80 rounded-full border border-slate-700 transition-colors cursor-pointer"
        >
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt={user.name || "User"}
              className="w-7 h-7 rounded-full object-cover"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
              {(user.username || user.name || "U")[0].toUpperCase()}
            </div>
          )}
        </button>

        {/* Profile Dropdown */}
        {dropdownOpen && (
          <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2">
            <div className="px-3 py-2 border-b border-slate-800 space-y-0.5">
              <p className="text-xs font-semibold text-slate-200">
                {user.name || user.username || "Developer"}
              </p>
              <p className="text-[11px] text-slate-400 font-mono truncate">
                @{user.username || "github_user"}
              </p>
            </div>

            <button
              onClick={() => signOut()}
              className="w-full mt-1 px-3 py-2 text-left text-xs text-red-400 hover:bg-red-500/10 rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
