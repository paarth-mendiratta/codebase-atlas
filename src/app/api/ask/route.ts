import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

interface FileNode {
  path: string;
  size: number;
  type: string;
}

interface ImportEdge {
  source: string;
  target: string;
}

function findRelevantFilesByKeywords(question: string, files: FileNode[]): string[] {
  const q = question.toLowerCase();
  const filePaths = files.map((f) => f.path);

  const matched = filePaths.filter((path) => {
    const p = path.toLowerCase();
    if (q.includes("color") || q.includes("style") || q.includes("ansi")) {
      return p.includes("style") || p.includes("ansi") || p.includes("color") || p.includes("index") || p.includes("vendor");
    }
    if (q.includes("test") || q.includes("spec")) {
      return p.includes("test") || p.includes("spec");
    }
    if (q.includes("auth") || q.includes("login") || q.includes("token")) {
      return p.includes("auth") || p.includes("login") || p.includes("token") || p.includes("user");
    }
    if (q.includes("entry") || q.includes("main") || q.includes("core") || q.includes("start")) {
      return p.includes("index") || p.includes("main") || p.includes("core") || p.includes("app");
    }
    const words = q.split(/\s+/).filter((w) => w.length > 3);
    return words.some((w) => p.includes(w));
  });

  if (matched.length > 0) {
    return matched.slice(0, 3);
  }

  // Fallback to core source files rather than config/docs
  const sourceFiles = filePaths.filter(
    (p) => !p.startsWith(".") && !p.endsWith(".md") && !p.includes("benchmark")
  );

  return sourceFiles.length > 0 ? sourceFiles.slice(0, 3) : filePaths.slice(0, 3);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { question, files, edges } = body as {
      question: string;
      files: FileNode[];
      edges: ImportEdge[];
    };

    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const fileListStr = (files || []).map((f) => f.path).join("\n");
    const edgeListStr = (edges || []).map((e) => `${e.source} -> ${e.target}`).join("\n");

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      const relevantFiles = findRelevantFilesByKeywords(question, files || []);
      return NextResponse.json({
        answer: `Analyzed repository layout for "${question}". Set GEMINI_API_KEY for AI-powered Q&A!`,
        relevantFiles,
      });
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-3.6-flash",
        generationConfig: { responseMimeType: "application/json" },
      });

      const prompt = `You are an AI codebase assistant analyzing a repository's directory structure and dependency graph.

Question from developer: "${question}"

Repository File List:
${fileListStr}

Dependency Import Edges (source -> target):
${edgeListStr}

Respond strictly in valid JSON format matching this schema:
{
  "answer": "A concise 2-4 sentence explanation answering the developer's question based on the codebase structure.",
  "relevantFiles": ["array of exact file paths from the file list that are relevant to this question"]
}`;

      const result = await model.generateContent(prompt);
      const rawText = result.response.text().trim();

      const parsed = JSON.parse(rawText);
      const relevantFiles = Array.isArray(parsed.relevantFiles) && parsed.relevantFiles.length > 0
        ? parsed.relevantFiles
        : findRelevantFilesByKeywords(question, files || []);

      return NextResponse.json({
        answer: parsed.answer || "Analyzed the codebase structure.",
        relevantFiles,
      });
    } catch (aiErr: unknown) {
      console.warn("[GEMINI ASK WARNING]", aiErr);
      const relevantFiles = findRelevantFilesByKeywords(question, files || []);

      return NextResponse.json({
        answer: `Based on the repository layout for "${question}", relevant core modules were identified in the codebase structure.`,
        relevantFiles,
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to answer question.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
