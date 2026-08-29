import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { filePath, fileContent, repoUrl } = body;

    if (!filePath) {
      return NextResponse.json({ error: "filePath is required" }, { status: 400 });
    }

    let contentToExplain = fileContent;

    if (!contentToExplain && repoUrl) {
      try {
        const url = new URL(repoUrl);
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length >= 2) {
          const owner = parts[0];
          const repo = parts[1].replace(/\.git$/, "");
          const rawRes = await fetch(
            `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${filePath}`
          );
          if (rawRes.ok) {
            contentToExplain = await rawRes.text();
          }
        }
      } catch {
        // Fallback
      }
    }

    if (contentToExplain) {
      const lines = contentToExplain.split("\n");
      if (lines.length > 200) {
        contentToExplain = lines.slice(0, 200).join("\n") + "\n...[truncated]";
      }
    } else {
      contentToExplain = "(File content empty or unavailable)";
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({
        explanation: `This file (\`${filePath}\`) appears to be a source module in the codebase. Set GEMINI_API_KEY in your environment to receive detailed AI-generated explanations.`,
      });
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

      const prompt = `You are an expert software engineer reviewing a codebase. Provide a clear, concise 2 to 4 sentence plain-English explanation of what this file does based on its path and content.

File Path: ${filePath}

File Content:
\`\`\`
${contentToExplain}
\`\`\`

Explanation:`;

      const result = await model.generateContent(prompt);
      const explanation = result.response.text().trim();

      return NextResponse.json({ explanation });
    } catch (aiErr: unknown) {
      console.warn("[GEMINI API WARNING]", aiErr);
      return NextResponse.json({
        explanation: `This file (\`${filePath}\`) serves as a core module in the codebase structure. (AI explanation fallback active).`,
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate explanation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
