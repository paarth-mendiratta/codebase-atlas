import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { saveAnalysis } from "@/lib/db";

// Allowlist extensions for relevant source files
const ALLOWED_EXTENSIONS = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "java",
  "go",
  "rb",
  "php",
  "css",
  "html",
  "md",
]);

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

export interface FileNode {
  path: string;
  size: number;
  type: string;
  sha: string;
}

export interface ImportEdge {
  source: string;
  target: string;
}

function parseGitHubUrl(urlStr: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(urlStr.trim());
    if (url.hostname !== "github.com") return null;

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    const owner = parts[0];
    let repo = parts[1];
    if (repo.endsWith(".git")) {
      repo = repo.slice(0, -4);
    }

    return { owner, repo };
  } catch {
    return null;
  }
}

function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  if (parts.length < 2) return "";
  return parts[parts.length - 1].toLowerCase();
}

function isSourceFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  if (
    normalized.includes("/node_modules/") ||
    normalized.startsWith("node_modules/") ||
    normalized.includes("/.git/") ||
    normalized.startsWith(".git/") ||
    normalized.includes("/dist/") ||
    normalized.startsWith("dist/") ||
    normalized.includes("/build/") ||
    normalized.startsWith("build/") ||
    normalized.includes("/.next/") ||
    normalized.startsWith(".next/") ||
    normalized.includes("/vendor/") ||
    normalized.startsWith("vendor/")
  ) {
    return false;
  }

  const ext = getExtension(filePath);
  return ALLOWED_EXTENSIONS.has(ext);
}

function resolveRelativeImport(
  sourcePath: string,
  importSpecifier: string,
  allPaths: Set<string>
): string | null {
  if (!importSpecifier.startsWith("./") && !importSpecifier.startsWith("../")) {
    return null;
  }

  const sourceDirParts = sourcePath.split("/").slice(0, -1);
  const importParts = importSpecifier.split("/");

  const resolvedParts = [...sourceDirParts];
  for (const part of importParts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (resolvedParts.length > 0) {
        resolvedParts.pop();
      }
    } else {
      resolvedParts.push(part);
    }
  }

  const basePath = resolvedParts.join("/");

  const extensionsToTry = [
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".java",
    ".go",
    ".rb",
    ".php",
    ".css",
    ".html",
    ".md",
    "/index.ts",
    "/index.tsx",
    "/index.js",
    "/index.jsx",
  ];

  for (const ext of extensionsToTry) {
    const candidate = `${basePath}${ext}`;
    if (allPaths.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractImports(sourcePath: string, content: string, allPaths: Set<string>): string[] {
  const ext = getExtension(sourcePath);
  const targets = new Set<string>();

  if (["js", "jsx", "ts", "tsx", "css", "html", "php"].includes(ext)) {
    const importFromRegex = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importFromRegex.exec(content)) !== null) {
      const specifier = match[1];
      const resolved = resolveRelativeImport(sourcePath, specifier, allPaths);
      if (resolved && resolved !== sourcePath) {
        targets.add(resolved);
      }
    }

    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      const specifier = match[1];
      const resolved = resolveRelativeImport(sourcePath, specifier, allPaths);
      if (resolved && resolved !== sourcePath) {
        targets.add(resolved);
      }
    }

    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(content)) !== null) {
      const specifier = match[1];
      const resolved = resolveRelativeImport(sourcePath, specifier, allPaths);
      if (resolved && resolved !== sourcePath) {
        targets.add(resolved);
      }
    }
  }

  if (ext === "py") {
    const pyFromRegex = /from\s+(\.[\w\.]+)\s+import/g;
    let match;
    while ((match = pyFromRegex.exec(content)) !== null) {
      const specifier = match[1].replace(/\./g, "/");
      const resolved = resolveRelativeImport(sourcePath, `./${specifier}`, allPaths);
      if (resolved && resolved !== sourcePath) {
        targets.add(resolved);
      }
    }
  }

  return Array.from(targets);
}

export async function POST(req: NextRequest) {
  try {
    let session = null;
    try {
      session = await getServerSession(authOptions);
    } catch (sessionErr) {
      console.error("[ANALYZE SESSION EVAL ERROR]", sessionErr);
      session = null;
    }

    const body = await req.json().catch(() => ({}));
    const { repoUrl } = body;

    if (!repoUrl || typeof repoUrl !== "string") {
      return NextResponse.json(
        { error: "A valid GitHub repository URL is required." },
        { status: 400 }
      );
    }

    const repoInfo = parseGitHubUrl(repoUrl);
    if (!repoInfo) {
      return NextResponse.json(
        { error: "Invalid GitHub URL format. Example: https://github.com/owner/repo" },
        { status: 400 }
      );
    }

    const { owner, repo } = repoInfo;
    const userToken = session?.accessToken;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Codebase-Atlas-App",
    };

    if (userToken) {
      headers["Authorization"] = `Bearer ${userToken}`;
    }

    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
    });

    if (repoRes.status === 404) {
      if (!userToken) {
        return NextResponse.json(
          {
            error:
              "This looks like a private repository — sign in with GitHub to analyze it.",
          },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `Repository '${owner}/${repo}' not found or access denied.` },
        { status: 404 }
      );
    }

    if (repoRes.status === 403 || repoRes.status === 429) {
      return NextResponse.json(
        { error: "GitHub API rate limit exceeded. Please try again in a few minutes." },
        { status: 429 }
      );
    }

    if (!repoRes.ok) {
      return NextResponse.json(
        { error: `GitHub API error (${repoRes.status}): ${repoRes.statusText}` },
        { status: repoRes.status }
      );
    }

    const repoData = await repoRes.json();
    const defaultBranch = repoData.default_branch || "main";

    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
      { headers }
    );

    if (treeRes.status === 403 || treeRes.status === 429) {
      return NextResponse.json(
        { error: "GitHub API rate limit exceeded while fetching repository tree." },
        { status: 429 }
      );
    }

    if (!treeRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch file tree for branch '${defaultBranch}'.` },
        { status: treeRes.status }
      );
    }

    const treeData = await treeRes.json();
    const treeItems: GitHubTreeItem[] = treeData.tree || [];

    const sourceFiles: GitHubTreeItem[] = treeItems.filter(
      (item) => item.type === "blob" && isSourceFile(item.path)
    );

    const MAX_FILES = 60;
    const filesToProcess = sourceFiles.slice(0, MAX_FILES);

    const allPathsSet = new Set(filesToProcess.map((f) => f.path));

    const files: FileNode[] = [];
    const edges: ImportEdge[] = [];
    let totalContentBytes = 0;

    await Promise.all(
      filesToProcess.map(async (fileItem) => {
        const size = fileItem.size || 0;
        totalContentBytes += size;

        files.push({
          path: fileItem.path,
          size,
          type: getExtension(fileItem.path),
          sha: fileItem.sha || `${fileItem.path}-${size}`,
        });

        try {
          const rawRes = await fetch(
            `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${fileItem.path}`,
            { headers }
          );

          if (rawRes.ok) {
            const content = await rawRes.text();
            const importedTargets = extractImports(fileItem.path, content, allPathsSet);

            for (const target of importedTargets) {
              edges.push({
                source: fileItem.path,
                target,
              });
            }
          }
        } catch {
          // Ignore individual fetch errors
        }
      })
    );

    if (session?.user?.id) {
      try {
        saveAnalysis(session.user.id, repoUrl, files, edges);
      } catch {
        // Ignore DB save errors
      }
    }

    return NextResponse.json({
      files,
      edges,
      truncated: sourceFiles.length > MAX_FILES,
      totalSourceFiles: sourceFiles.length,
      totalContentBytes,
    });
  } catch (err: unknown) {
    console.error("[ANALYZE ROUTE TOP-LEVEL ERROR]", err);
    const message = err instanceof Error ? err.message : "An unexpected server error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
