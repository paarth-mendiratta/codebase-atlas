# Codebase Atlas

Turn any GitHub repository into an interactive dependency map — with AI-powered file explanations, a codebase Q&A chat, and a compressed context export built for AI coding agents.

Built for BuildSprint 2026, using LatentCode.

## What it does

- **Paste a GitHub repo URL** → get an interactive force-directed graph of every file and its import relationships
- **Complexity hotspots** — files are sized and highlighted based on a weighted risk score (size, import count, centrality), so you instantly spot the riskiest files to change
- **Click any file** → get a real AI-generated explanation of what it does
- **Ask questions** in a chat panel ("where do tests live?") and get answers with relevant files highlighted on the graph
- **Export as CODEMAP.md** — a compressed architecture map (file summaries + dependency graph + AI-written overview) that developers can hand to any AI coding agent instead of having it re-read the whole repo. Typically 95-99% fewer tokens than a raw repo scan.
- **Sign in with GitHub** (optional) to analyze private repos and save your analysis history

## Why

AI coding agents burn a huge number of tokens just re-reading a codebase from scratch every session. Codebase Atlas generates a compact, pre-digested map once — so agents (and humans) get oriented instantly instead of re-scanning everything.

## Tech stack

- Next.js 14 (App Router), TypeScript, Tailwind CSS
- react-force-graph-2d for the interactive graph
- Gemini API for file explanations, chat Q&A, and architecture summaries
- NextAuth.js (GitHub OAuth) + SQLite for optional login/saved history
- GitHub REST API for repo analysis

## Running locally

```bash
npm install
```

Create a `.env.local` file (see `.env.local.example`) with:

GITHUB_ID=your_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret
NEXTAUTH_SECRET=a_random_secret_string
NEXTAUTH_URL=http://localhost:3000
GEMINI_API_KEY=your_gemini_api_key


Then:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## SkillPatch skills used

- `doc-coauthoring` — for structuring the exported CODEMAP.md
