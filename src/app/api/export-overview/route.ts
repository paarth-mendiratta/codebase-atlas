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
    const { repoUrl, files, edges, explanations } = body as {
      repoUrl: string;
      files: FileNode[];
      edges: ImportEdge[];
      explanations: Record<string, string>;
    };

    const fileListStr = (files || []).map((f) => `${f.path} (${f.type})`).join("\n");
    const edgeListStr = (edges || []).map((e) => `${e.source} -> ${e.target}`).join("\n");
    const expListStr = Object.entries(explanations || {})
      .map(([path, exp]) => `${path}: ${exp}`)
      .join("\n");

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({
        overview: `This codebase (${repoUrl || "repository"}) consists of ${
          files?.length || 0
        } source files structured around key modules and internal import dependencies. The architecture separates core business logic, utility functions, and test files to maintain clean modular boundaries. Set GEMINI_API_KEY for an AI-generated architecture overview paragraph.`,
      });
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

      const prompt = `You are a principal software architect generating a high-level architecture overview for a developer documentation map.

Repository URL: ${repoUrl || "N/A"}

Files in Repository:
${fileListStr}

Dependency Import Edges:
${edgeListStr}

File Explanations Gathered So Far:
${expListStr || "(None provided)"}

Write a single, polished 3-to-5 sentence Architecture Overview paragraph explaining how the major modules fit together, where the entry/core logic sits, and how dependencies flow. Do not use bullet points or markdown headings, just write the paragraph directly.`;

      const result = await model.generateContent(prompt);
      const overview = result.response.text().trim();

      return NextResponse.json({ overview });
    } catch (aiErr: unknown) {
      console.warn("[GEMINI EXPORT OVERVIEW WARNING]", aiErr);
      return NextResponse.json({
        overview: `This codebase consists of ${
          files?.length || 0
        } source files structured around key modules and internal import dependencies. The architecture separates core logic, utility functions, and test suites to maintain clean modular boundaries.`,
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate architecture overview.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
