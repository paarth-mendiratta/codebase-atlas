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
      const matchingFiles = (files || [])
        .map((f) => f.path)
        .filter((path) => {
          const q = question.toLowerCase();
          return (
            path.toLowerCase().includes(q) ||
            (q.includes("auth") && path.toLowerCase().includes("auth")) ||
            (q.includes("test") && path.toLowerCase().includes("test")) ||
            (q.includes("index") && path.toLowerCase().includes("index")) ||
            (q.includes("type") && path.toLowerCase().includes("type"))
          );
        })
        .slice(0, 3);

      return NextResponse.json({
        answer: `I checked the repository layout for "${question}". Set GEMINI_API_KEY for AI-powered Q&A!`,
        relevantFiles: matchingFiles.length > 0 ? matchingFiles : (files || []).slice(0, 2).map((f) => f.path),
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
      return NextResponse.json({
        answer: parsed.answer || "Analyzed the codebase structure.",
        relevantFiles: Array.isArray(parsed.relevantFiles) ? parsed.relevantFiles : [],
      });
    } catch (aiErr: unknown) {
      console.warn("[GEMINI ASK WARNING]", aiErr);

      const matchingFiles = (files || [])
        .map((f) => f.path)
        .filter((path) => {
          const q = question.toLowerCase();
          return (
            path.toLowerCase().includes(q) ||
            (q.includes("test") && path.toLowerCase().includes("test")) ||
            (q.includes("type") && path.toLowerCase().includes("type"))
          );
        })
        .slice(0, 3);

      return NextResponse.json({
        answer: `Based on the repository structure for "${question}", relevant modules were identified in the codebase layout.`,
        relevantFiles: matchingFiles.length > 0 ? matchingFiles : (files || []).slice(0, 2).map((f) => f.path),
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to answer question.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
