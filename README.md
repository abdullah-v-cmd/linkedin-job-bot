# LinkedIn Job Bot 🤖

## Project Overview
- **Name**: LinkedIn Job Bot
- **Goal**: Automated LinkedIn job searching, CV matching, AI answer generation, and GitHub sync
- **Stack**: Hono + TypeScript + Cloudflare Pages + TailwindCSS

## Features
- 🔍 **Job Search** - Search LinkedIn for latest jobs by title, location, keywords
- 📄 **CV Upload** - Drag & drop CV upload with AI analysis & skill extraction
- 🤖 **AI Answers** - Automatically generate smart answers to interview/application questions
- ⚡ **Auto Apply** - Automatically apply to matched jobs with configurable settings
- 🐙 **GitHub Sync** - Save job results, applications, and full bot structure to GitHub
- 📊 **Dashboard** - Real-time stats and activity tracking

## Setup
1. Open the app and go to **My CV** tab
2. Drag & drop or paste your CV
3. Go to **Job Search** and search for jobs
4. Go to **GitHub Sync** tab, paste your PAT and connect
5. Select or create a repository for saving results
6. Use **Auto Apply** to apply to jobs automatically

## GitHub Sync Options
- Save job results as `jobs/*.json`
- Save applications as `applications/*.json`
- Save full bot structure (sessions/ folder with summary.md)
- Custom filename export

## Tech Stack
- **Backend**: Hono framework on Cloudflare Workers
- **Frontend**: Vanilla JS + TailwindCSS CDN
- **Deploy**: Cloudflare Pages
- **Storage**: GitHub API for persistence

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: ✅ Active
- **Last Updated**: 2026-04-14
