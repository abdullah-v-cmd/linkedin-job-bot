# 🤖 LinkedIn Job Bot — Python Edition

A fully-featured, mobile-responsive LinkedIn job search bot built in **Python + Flask**.

## 🌐 Live URL
**Sandbox:** https://5000-ivcdpekc3txbiokxxdj18-ad490db5.sandbox.novita.ai  
**GitHub:** https://github.com/abdullah-v-cmd/linkedin-job-bot

---

## ✨ Features
| Feature | Description |
|---------|-------------|
| 🔍 Job Search | Search by title, location & keywords (LinkedIn + mock fallback) |
| 📄 CV Upload | Drag & drop PDF/TXT, AI-powered skill & experience extraction |
| 🚀 Auto-Apply | Bulk apply with match-score threshold, real-time log |
| 🤖 AI Answers | Smart interview answer generator for any question |
| 📥 Word Export | Download jobs as .docx Word document |
| 📊 CSV Export | Spreadsheet-ready CSV download |
| 🗂️ JSON Export | Raw JSON for developers |
| 🐙 GitHub Sync | Push results to any GitHub repo with your PAT |
| 📱 Mobile Responsive | Works on phones, tablets & desktops |

---

## 🚀 Run Locally (Step by Step)

### Prerequisites
- Python 3.10+ → https://python.org/downloads
- Git → https://git-scm.com/downloads

### Setup (one time)
```bash
git clone https://github.com/abdullah-v-cmd/linkedin-job-bot.git
cd linkedin-job-bot
pip install flask flask-cors requests beautifulsoup4 python-docx PyPDF2 lxml
```

### Start the bot
```bash
python app.py
```
Then open **http://localhost:5000** in your browser.

### Daily use (after first setup)
```bash
cd linkedin-job-bot
python app.py
# Open http://localhost:5000
```

---

## 📁 File Structure
```
linkedin-job-bot/
├── app.py                     ← Main Python Flask server (ALL logic here)
├── ecosystem_python.config.cjs ← PM2 config for sandbox
├── README.md
└── (src/, public/ - legacy Hono app, can ignore)
```

---

## 🔑 GitHub PAT Setup
1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Select scopes: `repo`, `read:user`
4. Copy token → paste in the **GitHub** tab of the bot

---

## 🛠️ Tech Stack
- **Backend:** Python 3.12, Flask, BeautifulSoup4
- **Frontend:** Vanilla JS + TailwindCSS (embedded in Flask)
- **Export:** python-docx (Word), CSV module, JSON
- **Deployment:** PM2 + Novita Sandbox / Localhost

---

## ⚠️ Notes
- LinkedIn may block scraping → bot falls back to realistic mock data
- Auto-apply **simulates** the process (real apply needs browser automation)
- Never share your GitHub PAT publicly

---

*Last updated: 2026-04-24*
