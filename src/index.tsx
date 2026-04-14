import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

const app = new Hono()

app.use('*', cors())
app.use('/static/*', serveStatic({ root: './' }))

// ─── LinkedIn Job Search API ────────────────────────────────────────────────
// Uses LinkedIn public job search (no auth required for basic search)
app.get('/api/jobs/search', async (c) => {
  const { title, location, keywords, count } = c.req.query()
  const jobTitle = title || 'Software Engineer'
  const jobLocation = location || ''
  const limit = parseInt(count || '25')

  try {
    // LinkedIn public job search endpoint
    const params = new URLSearchParams({
      keywords: keywords || jobTitle,
      location: jobLocation,
      f_TPR: 'r86400', // last 24 hours
      position: '1',
      pageNum: '0',
    })
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    })

    if (!res.ok) {
      // Return mock data if LinkedIn blocks
      return c.json({ jobs: generateMockJobs(jobTitle, jobLocation, limit), source: 'mock', total: limit })
    }

    const html = await res.text()
    const jobs = parseLinkedInJobs(html, limit)
    return c.json({ jobs, source: 'linkedin', total: jobs.length })
  } catch (e) {
    const jobs = generateMockJobs(jobTitle, jobLocation, limit)
    return c.json({ jobs, source: 'mock', total: jobs.length })
  }
})

// ─── CV Analysis API ─────────────────────────────────────────────────────────
app.post('/api/cv/analyze', async (c) => {
  const body = await c.req.json()
  const { cvText } = body
  if (!cvText) return c.json({ error: 'No CV text provided' }, 400)

  const skills = extractSkills(cvText)
  const experience = extractExperience(cvText)
  const education = extractEducation(cvText)
  const jobTitles = suggestJobTitles(skills, experience)
  const summary = generateCVSummary(skills, experience, education)

  return c.json({ skills, experience, education, jobTitles, summary, wordCount: cvText.split(' ').length })
})

// ─── AI Answer Generation ─────────────────────────────────────────────────────
app.post('/api/ai/generate-answer', async (c) => {
  const body = await c.req.json()
  const { question, cvText, jobTitle, company } = body
  const answer = generateSmartAnswer(question, cvText, jobTitle, company)
  return c.json({ answer, confidence: Math.floor(Math.random() * 20) + 80 })
})

// ─── Auto Apply Simulation ────────────────────────────────────────────────────
app.post('/api/jobs/apply', async (c) => {
  const body = await c.req.json()
  const { jobId, jobTitle, company, cvText, answers } = body

  // Simulate application submission
  const applicationId = `APP-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  const timestamp = new Date().toISOString()

  const result = {
    applicationId,
    jobId,
    jobTitle,
    company,
    status: 'submitted',
    timestamp,
    message: `Application successfully submitted to ${company} for ${jobTitle}`,
    answers: answers || [],
    estimatedResponse: '3-5 business days'
  }

  return c.json({ success: true, application: result })
})

// ─── GitHub API Routes ────────────────────────────────────────────────────────
app.post('/api/github/validate', async (c) => {
  const body = await c.req.json()
  const { pat } = body
  if (!pat) return c.json({ error: 'PAT required' }, 400)

  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `token ${pat}`, 'User-Agent': 'LinkedIn-Job-Bot' }
  })
  if (!res.ok) return c.json({ error: 'Invalid PAT' }, 401)
  const user = await res.json() as any
  return c.json({ valid: true, username: user.login, name: user.name, avatar: user.avatar_url })
})

app.post('/api/github/repos', async (c) => {
  const body = await c.req.json()
  const { pat } = body
  if (!pat) return c.json({ error: 'PAT required' }, 400)

  const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: { Authorization: `token ${pat}`, 'User-Agent': 'LinkedIn-Job-Bot' }
  })
  if (!res.ok) return c.json({ error: 'Failed to fetch repos' }, 400)
  const repos = await res.json() as any[]
  return c.json({ repos: repos.map((r: any) => ({ name: r.name, full_name: r.full_name, private: r.private, url: r.html_url })) })
})

app.post('/api/github/create-repo', async (c) => {
  const body = await c.req.json()
  const { pat, repoName, description, isPrivate } = body
  if (!pat || !repoName) return c.json({ error: 'PAT and repo name required' }, 400)

  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `token ${pat}`,
      'User-Agent': 'LinkedIn-Job-Bot',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: repoName,
      description: description || 'LinkedIn Job Bot Results',
      private: isPrivate || false,
      auto_init: true
    })
  })
  if (!res.ok) {
    const err = await res.json() as any
    return c.json({ error: err.message || 'Failed to create repo' }, 400)
  }
  const repo = await res.json() as any
  return c.json({ success: true, repo: { name: repo.name, full_name: repo.full_name, url: repo.html_url } })
})

app.post('/api/github/save', async (c) => {
  const body = await c.req.json()
  const { pat, repoFullName, filename, content, commitMessage } = body
  if (!pat || !repoFullName || !filename || !content) {
    return c.json({ error: 'Missing required fields' }, 400)
  }

  // Check if file exists
  let sha: string | undefined
  try {
    const existRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filename}`, {
      headers: { Authorization: `token ${pat}`, 'User-Agent': 'LinkedIn-Job-Bot' }
    })
    if (existRes.ok) {
      const existData = await existRes.json() as any
      sha = existData.sha
    }
  } catch (_) {}

  const encoded = btoa(unescape(encodeURIComponent(content)))
  const payload: any = {
    message: commitMessage || `Update ${filename} - ${new Date().toISOString()}`,
    content: encoded
  }
  if (sha) payload.sha = sha

  const res = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filename}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${pat}`,
      'User-Agent': 'LinkedIn-Job-Bot',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    const err = await res.json() as any
    return c.json({ error: err.message || 'Failed to save file' }, 400)
  }
  const data = await res.json() as any
  return c.json({ success: true, url: data.content?.html_url, sha: data.content?.sha })
})

// ─── Save to Bot File Structure ───────────────────────────────────────────────
app.post('/api/github/save-structure', async (c) => {
  const body = await c.req.json()
  const { pat, repoFullName, jobs, applications, sessionId } = body
  if (!pat || !repoFullName) return c.json({ error: 'Missing PAT or repo' }, 400)

  const ts = new Date().toISOString().split('T')[0]
  const sessionFolder = `sessions/${sessionId || ts}`
  const files: { path: string; content: string }[] = []

  // jobs.json
  files.push({
    path: `${sessionFolder}/jobs.json`,
    content: JSON.stringify({ timestamp: new Date().toISOString(), jobs }, null, 2)
  })

  // applications.json
  if (applications && applications.length > 0) {
    files.push({
      path: `${sessionFolder}/applications.json`,
      content: JSON.stringify({ timestamp: new Date().toISOString(), applications }, null, 2)
    })
  }

  // jobs-summary.md
  const summary = generateMarkdownSummary(jobs, applications, ts)
  files.push({ path: `${sessionFolder}/summary.md`, content: summary })

  // index.json at root
  files.push({
    path: 'index.json',
    content: JSON.stringify({
      lastUpdated: new Date().toISOString(),
      totalSessions: 1,
      latestSession: sessionFolder,
      stats: { totalJobs: jobs?.length || 0, totalApplications: applications?.length || 0 }
    }, null, 2)
  })

  // Save all files
  const results = []
  for (const file of files) {
    try {
      let sha: string | undefined
      try {
        const existRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${file.path}`, {
          headers: { Authorization: `token ${pat}`, 'User-Agent': 'LinkedIn-Job-Bot' }
        })
        if (existRes.ok) {
          const existData = await existRes.json() as any
          sha = existData.sha
        }
      } catch (_) {}

      const encoded = btoa(unescape(encodeURIComponent(file.content)))
      const payload: any = {
        message: `Bot save: ${file.path} - ${new Date().toISOString()}`,
        content: encoded
      }
      if (sha) payload.sha = sha

      const res = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${file.path}`, {
        method: 'PUT',
        headers: {
          Authorization: `token ${pat}`,
          'User-Agent': 'LinkedIn-Job-Bot',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      results.push({ path: file.path, success: res.ok })
    } catch (e) {
      results.push({ path: file.path, success: false, error: String(e) })
    }
  }

  return c.json({ success: true, savedFiles: results, sessionFolder })
})

// ─── Serve main HTML ──────────────────────────────────────────────────────────
app.get('/', (c) => c.html(getMainHTML()))
app.get('*', (c) => c.html(getMainHTML()))

// ─── Helper Functions ─────────────────────────────────────────────────────────
function parseLinkedInJobs(html: string, limit: number) {
  const jobs: any[] = []
  const jobPattern = /<li[^>]*>([\s\S]*?)<\/li>/g
  const titlePattern = /class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/
  const companyPattern = /class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/
  const locationPattern = /class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/
  const linkPattern = /href="(https:\/\/www\.linkedin\.com\/jobs\/view\/[^"]+)"/
  const timePattern = /datetime="([^"]+)"/

  let match
  while ((match = jobPattern.exec(html)) !== null && jobs.length < limit) {
    const block = match[1]
    const titleMatch = titlePattern.exec(block)
    const companyMatch = companyPattern.exec(block)
    const locationMatch = locationPattern.exec(block)
    const linkMatch = linkPattern.exec(block)
    const timeMatch = timePattern.exec(block)

    if (titleMatch && companyMatch) {
      jobs.push({
        id: `LI-${Date.now()}-${jobs.length}`,
        title: stripHtml(titleMatch[1]),
        company: stripHtml(companyMatch[1]),
        location: locationMatch ? stripHtml(locationMatch[1]) : 'Remote',
        url: linkMatch ? linkMatch[1] : '#',
        postedAt: timeMatch ? timeMatch[1] : new Date().toISOString(),
        source: 'linkedin',
        type: 'Full-time',
        salary: '',
        description: '',
        applied: false,
        saved: false
      })
    }
  }

  return jobs
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function generateMockJobs(title: string, location: string, count: number) {
  const companies = ['Google', 'Microsoft', 'Amazon', 'Apple', 'Meta', 'Netflix', 'Uber', 'Airbnb', 'Stripe', 'Shopify', 'Salesforce', 'Oracle', 'IBM', 'Intel', 'Adobe', 'Spotify', 'Twitter', 'LinkedIn', 'Dropbox', 'Slack']
  const locations = ['San Francisco, CA', 'New York, NY', 'Seattle, WA', 'Austin, TX', 'Remote', 'Boston, MA', 'Chicago, IL', 'Los Angeles, CA', 'Denver, CO', 'Atlanta, GA']
  const types = ['Full-time', 'Contract', 'Part-time', 'Remote']
  const salaries = ['$80k-$120k', '$100k-$150k', '$120k-$180k', '$90k-$130k', '$110k-$160k', 'Competitive', 'DOE']
  const descriptions = [
    `We are looking for a talented ${title} to join our team. You will work on cutting-edge projects and collaborate with world-class engineers.`,
    `Join our growing team as a ${title}. We offer competitive salary, great benefits, and an amazing work culture.`,
    `Exciting opportunity for an experienced ${title}. Work with modern technologies and make real impact.`,
    `We are seeking a passionate ${title} who loves solving complex problems and building scalable systems.`,
    `Great opportunity for a ${title} to grow their career at a fast-paced startup with great funding.`
  ]

  return Array.from({ length: count }, (_, i) => ({
    id: `JOB-${Date.now()}-${i}`,
    title: `${title}${i % 3 === 0 ? ' - Senior' : i % 5 === 0 ? ' - Lead' : ''}`,
    company: companies[i % companies.length],
    location: location || locations[i % locations.length],
    url: `https://www.linkedin.com/jobs/view/${1000000 + i}`,
    postedAt: new Date(Date.now() - Math.random() * 86400000 * 7).toISOString(),
    source: 'linkedin',
    type: types[i % types.length],
    salary: salaries[i % salaries.length],
    description: descriptions[i % descriptions.length],
    applied: false,
    saved: false,
    matchScore: Math.floor(Math.random() * 40) + 60
  }))
}

function extractSkills(cvText: string): string[] {
  const skillKeywords = ['JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'React', 'Vue', 'Angular', 'Node.js', 'Express', 'Django', 'Flask', 'Spring', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'SQL', 'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'GraphQL', 'REST', 'Git', 'CI/CD', 'Machine Learning', 'TensorFlow', 'PyTorch', 'Agile', 'Scrum', 'HTML', 'CSS', 'Tailwind', 'Bootstrap', 'Redux', 'Next.js', 'Nuxt', 'Svelte', 'Go', 'Rust', 'PHP', 'Laravel', 'Ruby', 'Rails', 'Swift', 'Kotlin', 'Flutter', 'React Native', 'Linux', 'Bash', 'Terraform', 'Ansible']
  const found = skillKeywords.filter(skill => cvText.toLowerCase().includes(skill.toLowerCase()))
  return found.length > 0 ? found : ['Communication', 'Problem Solving', 'Teamwork', 'Leadership']
}

function extractExperience(cvText: string): string {
  const yearMatch = cvText.match(/(\d+)\+?\s*years?\s*(of\s*)?(experience|exp)/i)
  if (yearMatch) return `${yearMatch[1]}+ years`
  const seniorMatch = cvText.match(/\b(senior|sr\.|lead|principal|staff|manager|director)\b/i)
  if (seniorMatch) return 'Senior Level'
  return 'Mid Level'
}

function extractEducation(cvText: string): string {
  if (/ph\.?d|doctorate/i.test(cvText)) return 'PhD'
  if (/master|m\.s\.|m\.eng|mba/i.test(cvText)) return "Master's Degree"
  if (/bachelor|b\.s\.|b\.eng|b\.a\.|undergraduate/i.test(cvText)) return "Bachelor's Degree"
  if (/associate|a\.s\./i.test(cvText)) return "Associate's Degree"
  if (/bootcamp|certification|certified/i.test(cvText)) return 'Certification / Bootcamp'
  return 'Education details not found'
}

function suggestJobTitles(skills: string[], experience: string): string[] {
  const titleMap: Record<string, string[]> = {
    'React': ['Frontend Developer', 'React Developer', 'UI Engineer'],
    'Python': ['Python Developer', 'Backend Engineer', 'Data Engineer'],
    'Machine Learning': ['ML Engineer', 'Data Scientist', 'AI Engineer'],
    'Docker': ['DevOps Engineer', 'Platform Engineer', 'SRE'],
    'AWS': ['Cloud Engineer', 'Solutions Architect', 'DevOps Engineer'],
    'Node.js': ['Backend Developer', 'Full Stack Developer', 'Node.js Engineer'],
    'Java': ['Java Developer', 'Backend Engineer', 'Software Engineer'],
    'TypeScript': ['TypeScript Developer', 'Full Stack Developer', 'Frontend Engineer'],
  }
  const titles = new Set<string>(['Software Engineer'])
  skills.forEach(skill => {
    if (titleMap[skill]) titleMap[skill].forEach(t => titles.add(t))
  })
  const prefix = experience.includes('Senior') || experience.includes('5+') || experience.includes('7+') || experience.includes('10+') ? 'Senior ' : ''
  const result = Array.from(titles).slice(0, 5)
  return prefix ? result.map(t => t.startsWith('Senior') ? t : `${prefix}${t}`) : result
}

function generateCVSummary(skills: string[], experience: string, education: string): string {
  return `${experience} professional with ${education}. Key skills: ${skills.slice(0, 6).join(', ')}${skills.length > 6 ? ` and ${skills.length - 6} more` : ''}.`
}

function generateSmartAnswer(question: string, cvText: string, jobTitle: string, company: string): string {
  const q = question.toLowerCase()
  const skills = cvText ? extractSkills(cvText) : ['communication', 'problem-solving']
  const exp = cvText ? extractExperience(cvText) : 'several years'

  if (q.includes('yourself') || q.includes('about you') || q.includes('introduce')) {
    return `I am a ${exp} professional specializing in ${skills.slice(0, 3).join(', ')}. I'm passionate about building robust, scalable solutions and have a proven track record of delivering high-quality work. I'm excited about the opportunity at ${company || 'your company'} as it aligns perfectly with my expertise and career goals.`
  }
  if (q.includes('strength')) {
    return `My key strengths include strong technical expertise in ${skills.slice(0, 2).join(' and ')}, combined with excellent problem-solving abilities. I excel at breaking down complex challenges into manageable solutions and consistently deliver results on time. I'm also known for my collaborative approach and clear communication with cross-functional teams.`
  }
  if (q.includes('weakness')) {
    return `I sometimes focus too much on perfecting details, but I've learned to balance quality with deadlines. I've implemented time-boxing strategies and prioritization frameworks to manage this effectively, which has actually improved both my output quality and delivery speed.`
  }
  if (q.includes('why') && (q.includes('company') || q.includes('role') || q.includes('position'))) {
    return `I'm excited about this ${jobTitle} role at ${company || 'your company'} because of the innovative work being done here. The opportunity to apply my expertise in ${skills.slice(0, 2).join(' and ')} to real-world challenges at scale is exactly what I'm looking for in my next role. I admire the company's commitment to excellence and would love to contribute to the team's success.`
  }
  if (q.includes('salary') || q.includes('compensation') || q.includes('pay')) {
    return `Based on my ${exp} of experience and the current market rate for ${jobTitle} positions, I'm looking for a competitive package in line with industry standards. I'm open to discussing the full compensation package, including benefits and growth opportunities, as I believe the right role is about more than just the base salary.`
  }
  if (q.includes('experience') || q.includes('background')) {
    return `I have ${exp} of experience working as a ${jobTitle}, during which I've developed strong expertise in ${skills.slice(0, 4).join(', ')}. I've successfully led and contributed to multiple projects, consistently delivering results that exceeded expectations and provided real business value.`
  }
  if (q.includes('challenge') || q.includes('difficult') || q.includes('problem')) {
    return `In a previous role, I faced a critical system performance issue affecting thousands of users. I methodically diagnosed the root cause, implemented an optimized solution using ${skills[0] || 'best practices'}, and reduced response times by 60%. This experience taught me the importance of systematic problem-solving and proactive monitoring.`
  }
  if (q.includes('team') || q.includes('collaborate') || q.includes('work with')) {
    return `I thrive in collaborative environments. I believe the best solutions emerge from diverse perspectives and open communication. In my experience, I've successfully worked with cross-functional teams, mentored junior developers, and coordinated with product and design teams to deliver outstanding results.`
  }
  if (q.includes('remote') || q.includes('work from home') || q.includes('hybrid')) {
    return `I'm highly experienced with remote work and have developed effective systems for communication, time management, and collaboration in distributed environments. I'm comfortable with asynchronous communication tools and always maintain high productivity and clear communication regardless of work location.`
  }
  if (q.includes('available') || q.includes('start') || q.includes('notice')) {
    return `I'm available to start within 2-4 weeks, as I'd like to ensure a proper transition from my current responsibilities. If the position requires an earlier start date, I'm willing to discuss this further.`
  }
  return `Thank you for the question. Based on my ${exp} of experience in ${skills.slice(0, 2).join(' and ')}, I'm well-positioned to contribute meaningfully to this role at ${company || 'your company'}. I approach every challenge with a combination of technical expertise, critical thinking, and a commitment to delivering high-quality results. I'd be happy to discuss specific examples from my background that are particularly relevant to this position.`
}

function generateMarkdownSummary(jobs: any[], applications: any[], date: string): string {
  return `# LinkedIn Job Bot - Session Summary
**Date:** ${date}  
**Generated:** ${new Date().toISOString()}

## Statistics
| Metric | Count |
|--------|-------|
| Jobs Found | ${jobs?.length || 0} |
| Applications Submitted | ${applications?.length || 0} |
| Success Rate | ${applications?.length ? Math.round((applications.length / (jobs?.length || 1)) * 100) : 0}% |

## Jobs Found
${(jobs || []).slice(0, 20).map((j: any, i: number) => `${i + 1}. **${j.title}** at ${j.company} - ${j.location} [View](${j.url})`).join('\n')}

## Applications Submitted
${(applications || []).map((a: any, i: number) => `${i + 1}. **${a.jobTitle}** at ${a.company} - ID: \`${a.applicationId}\` - ${a.timestamp}`).join('\n')}

---
*Generated by LinkedIn Job Bot*`
}

function getMainHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>LinkedIn Job Bot 🤖</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"/>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<style>
  :root{--primary:#0077b5;--primary-dark:#005885;--accent:#00a0dc;--success:#21a366;--warning:#f59e0b;--danger:#ef4444;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#f0f4f8;color:#1a202c;min-height:100vh;}
  .gradient-bg{background:linear-gradient(135deg,#0077b5 0%,#00a0dc 50%,#005885 100%);}
  .glass{background:rgba(255,255,255,0.95);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.2);}
  .card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);padding:24px;margin-bottom:20px;transition:transform 0.2s,box-shadow 0.2s;}
  .card:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,0.12);}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;border:none;transition:all 0.2s;text-decoration:none;}
  .btn-primary{background:var(--primary);color:#fff;} .btn-primary:hover{background:var(--primary-dark);}
  .btn-success{background:var(--success);color:#fff;} .btn-success:hover{background:#1a8a52;}
  .btn-warning{background:var(--warning);color:#fff;} .btn-warning:hover{background:#d97706;}
  .btn-danger{background:var(--danger);color:#fff;} .btn-danger:hover{background:#dc2626;}
  .btn-outline{background:transparent;border:2px solid var(--primary);color:var(--primary);} .btn-outline:hover{background:var(--primary);color:#fff;}
  .btn-sm{padding:6px 14px;font-size:13px;}
  .btn:disabled{opacity:0.5;cursor:not-allowed;}
  .input{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;transition:border-color 0.2s;outline:none;background:#fff;}
  .input:focus{border-color:var(--primary);}
  .badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;}
  .badge-blue{background:#dbeafe;color:#1d4ed8;} .badge-green{background:#dcfce7;color:#166534;}
  .badge-yellow{background:#fef9c3;color:#854d0e;} .badge-red{background:#fee2e2;color:#991b1b;}
  .badge-purple{background:#f3e8ff;color:#7c3aed;} .badge-gray{background:#f1f5f9;color:#475569;}
  .drop-zone{border:3px dashed #cbd5e1;border-radius:16px;padding:48px 24px;text-align:center;transition:all 0.3s;cursor:pointer;background:#f8fafc;}
  .drop-zone.drag-over{border-color:var(--primary);background:#eff6ff;}
  .drop-zone.has-file{border-color:var(--success);background:#f0fdf4;}
  .tab-btn{padding:10px 20px;border:none;background:transparent;cursor:pointer;font-weight:600;font-size:14px;color:#64748b;border-bottom:3px solid transparent;transition:all 0.2s;}
  .tab-btn.active{color:var(--primary);border-bottom-color:var(--primary);}
  .job-card{background:#fff;border-radius:12px;border:2px solid #e2e8f0;padding:18px;margin-bottom:12px;transition:all 0.2s;position:relative;}
  .job-card:hover{border-color:var(--primary);box-shadow:0 4px 16px rgba(0,119,181,0.12);}
  .job-card.applied{border-color:var(--success);background:#f0fdf4;}
  .job-card.saved{border-left:4px solid var(--warning);}
  .progress-bar{height:8px;border-radius:4px;background:#e2e8f0;overflow:hidden;}
  .progress-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--primary),var(--accent));transition:width 0.5s;}
  .stat-card{background:linear-gradient(135deg,var(--c1),var(--c2));border-radius:16px;padding:20px;color:#fff;text-align:center;}
  .skill-tag{display:inline-block;background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;margin:2px;}
  .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;align-items:center;justify-content:center;backdrop-filter:blur(4px);}
  .modal.open{display:flex;}
  .modal-box{background:#fff;border-radius:20px;padding:32px;max-width:560px;width:90%;max-height:85vh;overflow-y:auto;animation:slideUp 0.3s ease;}
  @keyframes slideUp{from{transform:translateY(30px);opacity:0;}to{transform:translateY(0);opacity:1;}}
  .spinner{width:20px;height:20px;border:3px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;display:inline-block;}
  @keyframes spin{to{transform:rotate(360deg);}}
  .notification{position:fixed;top:20px;right:20px;z-index:2000;max-width:380px;border-radius:12px;padding:14px 18px;font-weight:600;font-size:14px;display:flex;align-items:center;gap:10px;animation:slideIn 0.3s ease;box-shadow:0 8px 24px rgba(0,0,0,0.2);}
  @keyframes slideIn{from{transform:translateX(100%);opacity:0;}to{transform:translateX(0);opacity:1;}}
  .sidebar{width:260px;min-width:260px;background:#fff;border-right:1px solid #e2e8f0;height:100vh;position:sticky;top:0;overflow-y:auto;padding:20px 0;}
  .nav-item{display:flex;align-items:center;gap:12px;padding:12px 20px;cursor:pointer;color:#64748b;font-weight:500;font-size:14px;transition:all 0.2s;border-radius:0 25px 25px 0;margin-right:12px;}
  .nav-item:hover{background:#eff6ff;color:var(--primary);}
  .nav-item.active{background:#eff6ff;color:var(--primary);font-weight:700;border-left:4px solid var(--primary);}
  .nav-item i{width:20px;text-align:center;}
  textarea.input{resize:vertical;min-height:120px;}
  .ai-bubble{background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border-radius:0 16px 16px 16px;padding:14px 18px;margin:8px 0;font-size:14px;line-height:1.6;}
  .typing-dot{display:inline-block;width:8px;height:8px;background:#fff;border-radius:50%;animation:typing 1.4s ease infinite;}
  .typing-dot:nth-child(2){animation-delay:0.2s;} .typing-dot:nth-child(3){animation-delay:0.4s;}
  @keyframes typing{0%,80%,100%{transform:scale(0.8);opacity:0.5;}40%{transform:scale(1);opacity:1;}}
  .match-bar{height:6px;border-radius:3px;background:#e2e8f0;overflow:hidden;margin-top:6px;}
  .match-fill{height:100%;border-radius:3px;}
  ::-webkit-scrollbar{width:6px;} ::-webkit-scrollbar-track{background:#f1f5f9;} ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px;}
  .section{display:none;} .section.active{display:block;}
  .toggle-switch{position:relative;display:inline-block;width:44px;height:24px;}
  .toggle-switch input{opacity:0;width:0;height:0;}
  .toggle-slider{position:absolute;cursor:pointer;inset:0;background:#cbd5e1;transition:.3s;border-radius:24px;}
  .toggle-slider:before{content:"";position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:white;transition:.3s;border-radius:50%;}
  input:checked + .toggle-slider{background:var(--primary);}
  input:checked + .toggle-slider:before{transform:translateX(20px);}
</style>
</head>
<body>

<div style="display:flex;min-height:100vh;">
<!-- Sidebar -->
<aside class="sidebar" id="sidebar">
  <div style="padding:20px;border-bottom:1px solid #e2e8f0;margin-bottom:12px;">
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:40px;height:40px;background:linear-gradient(135deg,#0077b5,#00a0dc);border-radius:10px;display:flex;align-items:center;justify-content:center;">
        <i class="fab fa-linkedin" style="color:#fff;font-size:20px;"></i>
      </div>
      <div>
        <div style="font-weight:800;font-size:15px;color:#0077b5;">LinkedIn</div>
        <div style="font-size:11px;color:#64748b;font-weight:600;">Job Bot 🤖</div>
      </div>
    </div>
  </div>
  <nav>
    <div class="nav-item active" onclick="showSection('dashboard')" id="nav-dashboard">
      <i class="fas fa-chart-line"></i> Dashboard
    </div>
    <div class="nav-item" onclick="showSection('search')" id="nav-search">
      <i class="fas fa-search"></i> Job Search
    </div>
    <div class="nav-item" onclick="showSection('cv')" id="nav-cv">
      <i class="fas fa-file-user"></i> My CV
    </div>
    <div class="nav-item" onclick="showSection('apply')" id="nav-apply">
      <i class="fas fa-paper-plane"></i> Auto Apply
    </div>
    <div class="nav-item" onclick="showSection('ai')" id="nav-ai">
      <i class="fas fa-robot"></i> AI Assistant
    </div>
    <div class="nav-item" onclick="showSection('github')" id="nav-github">
      <i class="fab fa-github"></i> GitHub Sync
    </div>
    <div class="nav-item" onclick="showSection('settings')" id="nav-settings">
      <i class="fas fa-cog"></i> Settings
    </div>
  </nav>
  <div style="margin-top:auto;padding:16px 20px;border-top:1px solid #e2e8f0;margin-top:20px;">
    <div id="statusIndicator" style="display:flex;align-items:center;gap:8px;font-size:13px;color:#64748b;">
      <div style="width:8px;height:8px;background:#21a366;border-radius:50%;"></div>
      Bot Ready
    </div>
    <div id="ghUserInfo" style="margin-top:8px;display:none;font-size:12px;color:#64748b;"></div>
  </div>
</aside>

<!-- Main Content -->
<main style="flex:1;padding:24px;overflow-y:auto;">

<!-- ── DASHBOARD ──────────────────────────────────────────────── -->
<section id="sec-dashboard" class="section active">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
    <div>
      <h1 style="font-size:28px;font-weight:800;color:#1a202c;">Dashboard</h1>
      <p style="color:#64748b;margin-top:4px;">Your LinkedIn job hunting command center</p>
    </div>
    <button class="btn btn-primary" onclick="showSection('search')">
      <i class="fas fa-search"></i> Find Jobs
    </button>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:24px;">
    <div class="stat-card" style="--c1:#0077b5;--c2:#00a0dc;">
      <div style="font-size:32px;font-weight:800;" id="stat-found">0</div>
      <div style="font-size:13px;opacity:0.9;margin-top:4px;"><i class="fas fa-briefcase"></i> Jobs Found</div>
    </div>
    <div class="stat-card" style="--c1:#7c3aed;--c2:#9d4edd;">
      <div style="font-size:32px;font-weight:800;" id="stat-saved">0</div>
      <div style="font-size:13px;opacity:0.9;margin-top:4px;"><i class="fas fa-bookmark"></i> Saved</div>
    </div>
    <div class="stat-card" style="--c1:#059669;--c2:#10b981;">
      <div style="font-size:32px;font-weight:800;" id="stat-applied">0</div>
      <div style="font-size:13px;opacity:0.9;margin-top:4px;"><i class="fas fa-paper-plane"></i> Applied</div>
    </div>
    <div class="stat-card" style="--c1:#d97706;--c2:#f59e0b;">
      <div style="font-size:32px;font-weight:800;" id="stat-responses">0</div>
      <div style="font-size:13px;opacity:0.9;margin-top:4px;"><i class="fas fa-envelope"></i> Responses</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
    <div class="card">
      <h3 style="font-weight:700;margin-bottom:16px;color:#1a202c;"><i class="fas fa-bolt" style="color:#f59e0b;"></i> Quick Actions</h3>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn btn-primary" onclick="showSection('search')" style="justify-content:center;"><i class="fas fa-search"></i> Search New Jobs</button>
        <button class="btn btn-success" onclick="showSection('cv')" style="justify-content:center;"><i class="fas fa-upload"></i> Upload My CV</button>
        <button class="btn btn-warning" onclick="showSection('apply')" style="justify-content:center;"><i class="fas fa-robot"></i> Auto Apply Mode</button>
        <button class="btn btn-outline" onclick="showSection('github')" style="justify-content:center;"><i class="fab fa-github"></i> Sync to GitHub</button>
      </div>
    </div>
    <div class="card">
      <h3 style="font-weight:700;margin-bottom:16px;color:#1a202c;"><i class="fas fa-clock" style="color:#0077b5;"></i> Recent Activity</h3>
      <div id="recentActivity" style="font-size:13px;color:#64748b;">
        <div style="text-align:center;padding:20px;color:#94a3b8;">
          <i class="fas fa-inbox" style="font-size:32px;margin-bottom:8px;"></i>
          <p>No activity yet. Start searching for jobs!</p>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <h3 style="font-weight:700;margin-bottom:16px;color:#1a202c;"><i class="fas fa-star" style="color:#f59e0b;"></i> Saved Jobs</h3>
    <div id="savedJobsList">
      <div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px;">
        <i class="fas fa-bookmark" style="font-size:28px;margin-bottom:8px;"></i>
        <p>No saved jobs yet. Save jobs from the search results!</p>
      </div>
    </div>
  </div>
</section>

<!-- ── JOB SEARCH ─────────────────────────────────────────────── -->
<section id="sec-search" class="section">
  <h1 style="font-size:28px;font-weight:800;color:#1a202c;margin-bottom:6px;">Job Search</h1>
  <p style="color:#64748b;margin-bottom:24px;">Search LinkedIn for the latest job openings</p>

  <div class="card">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:12px;align-items:end;">
      <div>
        <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">JOB TITLE / KEYWORDS</label>
        <input class="input" id="searchTitle" placeholder="e.g. Software Engineer, Data Scientist" value="Software Engineer"/>
      </div>
      <div>
        <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">LOCATION</label>
        <input class="input" id="searchLocation" placeholder="e.g. San Francisco, Remote"/>
      </div>
      <div>
        <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">RESULTS COUNT</label>
        <select class="input" id="searchCount">
          <option value="10">10 jobs</option>
          <option value="25" selected>25 jobs</option>
          <option value="50">50 jobs</option>
          <option value="100">100 jobs</option>
        </select>
      </div>
      <button class="btn btn-primary" onclick="searchJobs()" id="searchBtn" style="height:42px;">
        <i class="fas fa-search"></i> Search
      </button>
    </div>
    <div style="display:flex;gap:12px;margin-top:14px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:8px;">
        <label style="font-size:13px;font-weight:600;color:#64748b;">Filter by:</label>
      </div>
      <select class="input" id="filterType" style="width:auto;padding:6px 12px;font-size:13px;" onchange="filterJobs()">
        <option value="">All Types</option>
        <option value="Full-time">Full-time</option>
        <option value="Part-time">Part-time</option>
        <option value="Contract">Contract</option>
        <option value="Remote">Remote</option>
      </select>
      <select class="input" id="sortBy" style="width:auto;padding:6px 12px;font-size:13px;" onchange="filterJobs()">
        <option value="recent">Most Recent</option>
        <option value="match">Best Match</option>
        <option value="company">Company A-Z</option>
      </select>
      <div style="display:flex;align-items:center;gap:6px;">
        <label class="toggle-switch"><input type="checkbox" id="cvMatchToggle" onchange="filterJobs()"><span class="toggle-slider"></span></label>
        <span style="font-size:13px;font-weight:600;color:#64748b;">CV Match Only</span>
      </div>
    </div>
  </div>

  <div id="searchResults" style="min-height:200px;">
    <div style="text-align:center;padding:60px;color:#94a3b8;">
      <i class="fas fa-search" style="font-size:48px;margin-bottom:16px;"></i>
      <h3 style="font-size:18px;font-weight:600;">Ready to search</h3>
      <p style="margin-top:8px;">Enter a job title and click Search</p>
    </div>
  </div>
</section>

<!-- ── CV SECTION ─────────────────────────────────────────────── -->
<section id="sec-cv" class="section">
  <h1 style="font-size:28px;font-weight:800;color:#1a202c;margin-bottom:6px;">My CV / Resume</h1>
  <p style="color:#64748b;margin-bottom:24px;">Upload your CV and let the bot analyze and match jobs for you</p>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
    <div>
      <div class="card">
        <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-upload" style="color:#0077b5;"></i> Upload CV</h3>
        <div class="drop-zone" id="dropZone" onclick="document.getElementById('cvFile').click()" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
          <input type="file" id="cvFile" accept=".pdf,.doc,.docx,.txt" style="display:none" onchange="handleFileSelect(event)"/>
          <div id="dropContent">
            <i class="fas fa-cloud-upload-alt" style="font-size:48px;color:#94a3b8;margin-bottom:16px;"></i>
            <h3 style="font-size:16px;font-weight:700;color:#64748b;">Drag & Drop your CV here</h3>
            <p style="font-size:13px;color:#94a3b8;margin-top:8px;">or click to browse files</p>
            <p style="font-size:11px;color:#cbd5e1;margin-top:8px;">Supports PDF, DOC, DOCX, TXT</p>
          </div>
        </div>
        <div style="margin-top:16px;">
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:8px;">OR PASTE CV TEXT DIRECTLY</label>
          <textarea class="input" id="cvTextInput" placeholder="Paste your CV/resume text here..." rows="8"></textarea>
          <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:10px;" onclick="analyzeCV()">
            <i class="fas fa-brain"></i> Analyze CV
          </button>
        </div>
      </div>
    </div>

    <div>
      <div class="card" id="cvAnalysisCard" style="display:none;">
        <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-chart-pie" style="color:#7c3aed;"></i> CV Analysis</h3>
        <div id="cvAnalysisContent"></div>
      </div>
      <div class="card" style="background:linear-gradient(135deg,#eff6ff,#fff);">
        <h3 style="font-weight:700;margin-bottom:12px;"><i class="fas fa-lightbulb" style="color:#f59e0b;"></i> Tips</h3>
        <ul style="font-size:13px;color:#64748b;line-height:2;">
          <li>✅ Upload your most recent CV</li>
          <li>✅ Include all your skills and technologies</li>
          <li>✅ Add quantified achievements</li>
          <li>✅ Use keywords from job descriptions</li>
          <li>✅ Keep it to 1-2 pages maximum</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<!-- ── AUTO APPLY ─────────────────────────────────────────────── -->
<section id="sec-apply" class="section">
  <h1 style="font-size:28px;font-weight:800;color:#1a202c;margin-bottom:6px;">Auto Apply</h1>
  <p style="color:#64748b;margin-bottom:24px;">Automatically apply to matched jobs with AI-generated answers</p>

  <div style="display:grid;grid-template-columns:1fr 2fr;gap:20px;">
    <div>
      <div class="card">
        <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-sliders-h" style="color:#0077b5;"></i> Auto Apply Settings</h3>
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">MAX APPLICATIONS</label>
            <input class="input" type="number" id="maxApply" value="10" min="1" max="100"/>
          </div>
          <div>
            <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">MIN MATCH SCORE (%)</label>
            <input class="input" type="number" id="minScore" value="70" min="0" max="100"/>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:13px;font-weight:600;color:#64748b;">AI Answer Mode</span>
            <label class="toggle-switch"><input type="checkbox" id="aiAnswerMode" checked><span class="toggle-slider"></span></label>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:13px;font-weight:600;color:#64748b;">Skip Applied</span>
            <label class="toggle-switch"><input type="checkbox" id="skipApplied" checked><span class="toggle-slider"></span></label>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:13px;font-weight:600;color:#64748b;">Auto-save to GitHub</span>
            <label class="toggle-switch"><input type="checkbox" id="autoGithub"><span class="toggle-slider"></span></label>
          </div>
          <button class="btn btn-success" onclick="startAutoApply()" id="autoApplyBtn" style="justify-content:center;width:100%;">
            <i class="fas fa-robot"></i> Start Auto Apply
          </button>
          <button class="btn btn-danger" onclick="stopAutoApply()" id="stopApplyBtn" style="justify-content:center;width:100%;display:none;">
            <i class="fas fa-stop"></i> Stop
          </button>
        </div>
      </div>

      <div class="card">
        <h3 style="font-weight:700;margin-bottom:12px;"><i class="fas fa-chart-bar" style="color:#7c3aed;"></i> Apply Progress</h3>
        <div id="applyProgress" style="font-size:13px;color:#64748b;text-align:center;padding:10px;">Ready to apply</div>
        <div class="progress-bar" style="margin-top:10px;"><div class="progress-fill" id="applyProgressBar" style="width:0%"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;color:#94a3b8;">
          <span id="applyCount">0 applied</span>
          <span id="applyTotal">/ 0 total</span>
        </div>
      </div>
    </div>

    <div>
      <div class="card">
        <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-list-check" style="color:#059669;"></i> Application Queue</h3>
        <div id="applicationQueue">
          <div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px;">
            <i class="fas fa-inbox" style="font-size:32px;margin-bottom:8px;"></i>
            <p>No jobs in queue. Search for jobs first, then enable Auto Apply.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ── AI ASSISTANT ────────────────────────────────────────────── -->
<section id="sec-ai" class="section">
  <h1 style="font-size:28px;font-weight:800;color:#1a202c;margin-bottom:6px;">AI Assistant</h1>
  <p style="color:#64748b;margin-bottom:24px;">Generate perfect answers to job application questions</p>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
    <div class="card">
      <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-magic" style="color:#7c3aed;"></i> Answer Generator</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">JOB TITLE</label>
          <input class="input" id="aiJobTitle" placeholder="e.g. Senior Software Engineer"/>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">COMPANY</label>
          <input class="input" id="aiCompany" placeholder="e.g. Google"/>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">INTERVIEW QUESTION</label>
          <textarea class="input" id="aiQuestion" rows="4" placeholder="e.g. Tell me about yourself. Why do you want to work here? What is your greatest strength?"></textarea>
        </div>
        <button class="btn btn-primary" onclick="generateAnswer()" id="generateBtn" style="justify-content:center;">
          <i class="fas fa-magic"></i> Generate Answer
        </button>
      </div>

      <div style="margin-top:20px;">
        <h4 style="font-weight:700;margin-bottom:10px;font-size:13px;color:#64748b;">COMMON QUESTIONS</h4>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${['Tell me about yourself', 'Why do you want this job?', 'What is your greatest strength?', 'What is your greatest weakness?', 'Where do you see yourself in 5 years?', 'Why should we hire you?', 'What is your salary expectation?', 'Are you available for remote work?'].map(q => `<button class="btn btn-outline btn-sm" onclick="document.getElementById('aiQuestion').value='${q}'">${q}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-robot" style="color:#0077b5;"></i> AI Response</h3>
      <div id="aiResponseArea" style="min-height:200px;">
        <div style="text-align:center;padding:40px;color:#94a3b8;">
          <i class="fas fa-robot" style="font-size:48px;margin-bottom:16px;"></i>
          <p>Your AI-generated answer will appear here</p>
        </div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:20px;">
    <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-history" style="color:#64748b;"></i> Answer History</h3>
    <div id="answerHistory">
      <div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px;">No answers generated yet.</div>
    </div>
  </div>
</section>

<!-- ── GITHUB SYNC ─────────────────────────────────────────────── -->
<section id="sec-github" class="section">
  <h1 style="font-size:28px;font-weight:800;color:#1a202c;margin-bottom:6px;">GitHub Sync</h1>
  <p style="color:#64748b;margin-bottom:24px;">Save your job search results and applications to GitHub</p>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
    <!-- Connect -->
    <div class="card">
      <h3 style="font-weight:700;margin-bottom:16px;"><i class="fab fa-github" style="color:#1a202c;"></i> Connect GitHub</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">GITHUB PAT (Personal Access Token)</label>
          <div style="position:relative;">
            <input class="input" type="password" id="ghPAT" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" style="padding-right:44px;"/>
            <button onclick="togglePATVisibility()" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#64748b;">
              <i class="fas fa-eye" id="patEyeIcon"></i>
            </button>
          </div>
          <p style="font-size:11px;color:#94a3b8;margin-top:4px;">Needs repo scope. <a href="https://github.com/settings/tokens/new" target="_blank" style="color:#0077b5;">Create token →</a></p>
        </div>
        <button class="btn btn-primary" onclick="validateGitHub()" id="ghConnectBtn" style="justify-content:center;">
          <i class="fab fa-github"></i> Connect
        </button>
        <div id="ghUserCard" style="display:none;background:#f8fafc;border-radius:10px;padding:14px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <img id="ghAvatar" src="" alt="" style="width:44px;height:44px;border-radius:50%;"/>
            <div>
              <div id="ghUsername" style="font-weight:700;font-size:15px;"></div>
              <div id="ghName" style="font-size:12px;color:#64748b;"></div>
            </div>
            <span class="badge badge-green" style="margin-left:auto;"><i class="fas fa-check-circle"></i> Connected</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Repository Selection -->
    <div class="card">
      <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-code-branch" style="color:#7c3aed;"></i> Select Repository</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div id="repoSelection">
          <p style="font-size:13px;color:#94a3b8;">Connect GitHub first to select a repository.</p>
        </div>
      </div>
    </div>

    <!-- Create New Repo -->
    <div class="card">
      <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-plus-circle" style="color:#059669;"></i> Create New Repository</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">REPOSITORY NAME</label>
          <input class="input" id="newRepoName" placeholder="e.g. linkedin-job-results"/>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">DESCRIPTION</label>
          <input class="input" id="newRepoDesc" placeholder="LinkedIn Job Bot Results"/>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:13px;font-weight:600;color:#64748b;">Private Repository</span>
          <label class="toggle-switch"><input type="checkbox" id="newRepoPrivate"><span class="toggle-slider"></span></label>
        </div>
        <button class="btn btn-success" onclick="createRepo()" id="createRepoBtn" style="justify-content:center;">
          <i class="fas fa-plus"></i> Create Repository
        </button>
      </div>
    </div>

    <!-- Save Options -->
    <div class="card">
      <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-save" style="color:#d97706;"></i> Save Options</h3>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn btn-primary" onclick="saveToGithub('jobs')" style="justify-content:center;">
          <i class="fas fa-briefcase"></i> Save Job Results (jobs.json)
        </button>
        <button class="btn btn-success" onclick="saveToGithub('applications')" style="justify-content:center;">
          <i class="fas fa-paper-plane"></i> Save Applications (applications.json)
        </button>
        <button class="btn btn-warning" onclick="saveToGithub('structure')" style="justify-content:center;">
          <i class="fas fa-folder-tree"></i> Save Full Bot Structure
        </button>
        <hr style="border:none;border-top:1px solid #e2e8f0;"/>
        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">CUSTOM FILENAME</label>
          <div style="display:flex;gap:8px;">
            <input class="input" id="customFilename" placeholder="custom-export.json"/>
            <button class="btn btn-outline btn-sm" onclick="saveCustomFile()"><i class="fas fa-save"></i></button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Sync Log -->
  <div class="card" style="margin-top:4px;">
    <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-terminal" style="color:#1a202c;"></i> Sync Log</h3>
    <div id="syncLog" style="background:#0f172a;border-radius:10px;padding:16px;min-height:120px;font-family:monospace;font-size:13px;color:#94a3b8;">
      <div style="color:#22d3ee;">> LinkedIn Job Bot GitHub Sync Ready</div>
      <div style="color:#4ade80;">> Connect your GitHub PAT to get started</div>
    </div>
  </div>
</section>

<!-- ── SETTINGS ────────────────────────────────────────────────── -->
<section id="sec-settings" class="section">
  <h1 style="font-size:28px;font-weight:800;color:#1a202c;margin-bottom:6px;">Settings</h1>
  <p style="color:#64748b;margin-bottom:24px;">Configure your LinkedIn Job Bot preferences</p>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
    <div class="card">
      <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-search" style="color:#0077b5;"></i> Default Search Preferences</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">DEFAULT JOB TITLE</label>
          <input class="input" id="settDefaultTitle" placeholder="Software Engineer"/>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">DEFAULT LOCATION</label>
          <input class="input" id="settDefaultLocation" placeholder="Remote"/>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">PREFERRED JOB TYPES</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${['Full-time','Part-time','Contract','Remote','Internship'].map(t=>`<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;"><input type="checkbox" id="type_${t.toLowerCase()}" ${t==='Full-time'||t==='Remote'?'checked':''}/> ${t}</label>`).join('')}
          </div>
        </div>
        <button class="btn btn-primary" onclick="saveSettings()" style="justify-content:center;"><i class="fas fa-save"></i> Save Preferences</button>
      </div>
    </div>

    <div class="card">
      <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-robot" style="color:#7c3aed;"></i> AI & Automation</h3>
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div><div style="font-weight:600;font-size:14px;">Auto-apply on search</div><div style="font-size:12px;color:#94a3b8;">Apply immediately after searching</div></div>
          <label class="toggle-switch"><input type="checkbox" id="settAutoApply"><span class="toggle-slider"></span></label>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div><div style="font-weight:600;font-size:14px;">AI answer generation</div><div style="font-size:12px;color:#94a3b8;">Use AI for application questions</div></div>
          <label class="toggle-switch"><input type="checkbox" id="settAIAnswers" checked><span class="toggle-slider"></span></label>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div><div style="font-weight:600;font-size:14px;">Auto-save to GitHub</div><div style="font-size:12px;color:#94a3b8;">Save results automatically</div></div>
          <label class="toggle-switch"><input type="checkbox" id="settAutoGithub"><span class="toggle-slider"></span></label>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div><div style="font-weight:600;font-size:14px;">Email notifications</div><div style="font-size:12px;color:#94a3b8;">Get notified of new matches</div></div>
          <label class="toggle-switch"><input type="checkbox" id="settNotifications"><span class="toggle-slider"></span></label>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-trash" style="color:#ef4444;"></i> Data Management</h3>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn btn-outline" onclick="exportData()" style="justify-content:center;"><i class="fas fa-download"></i> Export All Data (JSON)</button>
        <button class="btn btn-warning" onclick="clearJobs()" style="justify-content:center;"><i class="fas fa-broom"></i> Clear Job Results</button>
        <button class="btn btn-danger" onclick="clearAllData()" style="justify-content:center;"><i class="fas fa-trash"></i> Clear All Data</button>
      </div>
    </div>

    <div class="card" style="background:linear-gradient(135deg,#f0f9ff,#fff);">
      <h3 style="font-weight:700;margin-bottom:16px;"><i class="fas fa-info-circle" style="color:#0077b5;"></i> About</h3>
      <div style="font-size:13px;color:#64748b;line-height:1.8;">
        <div><strong>LinkedIn Job Bot v2.0</strong></div>
        <div>Built with Hono + Cloudflare Workers</div>
        <div style="margin-top:8px;">Features:</div>
        <ul style="margin-left:16px;margin-top:4px;">
          <li>✅ LinkedIn job scraping</li>
          <li>✅ CV analysis & matching</li>
          <li>✅ AI answer generation</li>
          <li>✅ Auto-apply simulation</li>
          <li>✅ GitHub sync & storage</li>
          <li>✅ Drag & drop CV upload</li>
        </ul>
      </div>
    </div>
  </div>
</section>

</main>
</div>

<!-- Apply Modal -->
<div class="modal" id="applyModal">
  <div class="modal-box">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <h2 style="font-weight:800;font-size:20px;">Apply to Job</h2>
      <button onclick="closeModal('applyModal')" style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b;">✕</button>
    </div>
    <div id="applyModalContent"></div>
  </div>
</div>

<!-- Job Detail Modal -->
<div class="modal" id="jobDetailModal">
  <div class="modal-box">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <h2 style="font-weight:800;font-size:20px;">Job Details</h2>
      <button onclick="closeModal('jobDetailModal')" style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b;">✕</button>
    </div>
    <div id="jobDetailContent"></div>
  </div>
</div>

<script>
// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  jobs: [],
  filteredJobs: [],
  applications: [],
  savedJobs: [],
  cvText: '',
  cvSkills: [],
  cvJobTitles: [],
  github: { connected: false, username: '', pat: '', selectedRepo: '', repos: [] },
  autoApplying: false,
  answerHistory: [],
  activity: []
};

// Load from localStorage
function loadState() {
  try {
    const saved = localStorage.getItem('ljb_state');
    if (saved) {
      const s = JSON.parse(saved);
      Object.assign(state, s);
      state.autoApplying = false;
    }
  } catch(e) {}
  updateStats();
  renderSavedJobs();
  renderActivity();
  if (state.github.pat) {
    document.getElementById('ghPAT').value = state.github.pat;
    if (state.github.connected) showGithubUser();
  }
}

function saveState() {
  try { localStorage.setItem('ljb_state', JSON.stringify(state)); } catch(e) {}
}

// ─── Navigation ──────────────────────────────────────────────────────────────
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('sec-' + id).classList.add('active');
  document.getElementById('nav-' + id).classList.add('active');
}

// ─── Notifications ────────────────────────────────────────────────────────────
function notify(msg, type='success') {
  const colors = { success:'#059669', error:'#ef4444', info:'#0077b5', warning:'#d97706' };
  const icons = { success:'check-circle', error:'exclamation-circle', info:'info-circle', warning:'exclamation-triangle' };
  const n = document.createElement('div');
  n.className = 'notification';
  n.style.background = colors[type] || colors.info;
  n.style.color = '#fff';
  n.innerHTML = \`<i class="fas fa-\${icons[type]}"></i><span>\${msg}</span>\`;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 4000);
}

// ─── Job Search ───────────────────────────────────────────────────────────────
async function searchJobs() {
  const title = document.getElementById('searchTitle').value.trim() || 'Software Engineer';
  const location = document.getElementById('searchLocation').value.trim();
  const count = document.getElementById('searchCount').value;
  const btn = document.getElementById('searchBtn');
  btn.innerHTML = '<span class="spinner"></span> Searching...';
  btn.disabled = true;

  document.getElementById('searchResults').innerHTML = \`
    <div style="text-align:center;padding:60px;color:#94a3b8;">
      <div class="spinner" style="width:48px;height:48px;border-color:rgba(0,119,181,0.3);border-top-color:#0077b5;margin:0 auto 16px;"></div>
      <p style="font-weight:600;">Searching LinkedIn for <strong>\${title}</strong> jobs...</p>
    </div>\`;

  try {
    const res = await axios.get(\`/api/jobs/search?title=\${encodeURIComponent(title)}&location=\${encodeURIComponent(location)}&count=\${count}\`);
    const { jobs, source, total } = res.data;
    state.jobs = jobs;
    state.filteredJobs = jobs;
    saveState();
    renderJobResults(jobs, source);
    updateStats();
    addActivity(\`Searched for "\${title}" - found \${total} jobs\`, 'search');
  } catch(e) {
    document.getElementById('searchResults').innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;">Search failed. Please try again.</div>';
    notify('Search failed: ' + (e.message || 'Unknown error'), 'error');
  }

  btn.innerHTML = '<i class="fas fa-search"></i> Search';
  btn.disabled = false;
}

function renderJobResults(jobs, source) {
  const el = document.getElementById('searchResults');
  if (!jobs.length) { el.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">No jobs found. Try different keywords.</div>'; return; }

  const sourceLabel = source === 'linkedin' ? '<span class="badge badge-blue"><i class="fab fa-linkedin"></i> LinkedIn Live</span>' : '<span class="badge badge-yellow"><i class="fas fa-database"></i> Demo Data</span>';
  el.innerHTML = \`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-weight:700;color:#1a202c;">\${jobs.length} Jobs Found \${sourceLabel}</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-success btn-sm" onclick="applyAllJobs()"><i class="fas fa-robot"></i> Apply All</button>
        <button class="btn btn-outline btn-sm" onclick="saveAllJobs()"><i class="fas fa-bookmark"></i> Save All</button>
        <button class="btn btn-warning btn-sm" onclick="saveToGithub('jobs')"><i class="fab fa-github"></i> Save to GitHub</button>
      </div>
    </div>
    <div id="jobList">\${jobs.map((j,i) => renderJobCard(j,i)).join('')}</div>\`;
}

function renderJobCard(job, idx) {
  const match = job.matchScore || Math.floor(Math.random()*40+60);
  const matchColor = match >= 85 ? '#059669' : match >= 70 ? '#d97706' : '#64748b';
  const postedAgo = timeSince(job.postedAt);
  const isSaved = state.savedJobs.some(j => j.id === job.id);
  const isApplied = state.applications.some(a => a.jobId === job.id);

  return \`<div class="job-card \${isApplied?'applied':''} \${isSaved&&!isApplied?'saved':''}" id="jc-\${job.id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
          <h3 style="font-size:16px;font-weight:700;color:#1a202c;">\${job.title}</h3>
          \${isApplied ? '<span class="badge badge-green"><i class="fas fa-check"></i> Applied</span>' : ''}
          \${isSaved && !isApplied ? '<span class="badge badge-yellow"><i class="fas fa-bookmark"></i> Saved</span>' : ''}
        </div>
        <div style="display:flex;align-items:center;gap:16px;font-size:13px;color:#64748b;flex-wrap:wrap;">
          <span><i class="fas fa-building" style="color:#0077b5;"></i> \${job.company}</span>
          <span><i class="fas fa-map-marker-alt" style="color:#ef4444;"></i> \${job.location}</span>
          <span><i class="fas fa-clock" style="color:#94a3b8;"></i> \${postedAgo}</span>
          \${job.type ? '<span class="badge badge-blue">'+job.type+'</span>' : ''}
          \${job.salary ? '<span class="badge badge-green">'+job.salary+'</span>' : ''}
        </div>
        \${job.description ? '<p style="font-size:13px;color:#64748b;margin-top:8px;line-height:1.5;">'+(job.description.substring(0,120))+'...</p>' : ''}
      </div>
      <div style="text-align:right;min-width:80px;">
        <div style="font-size:12px;font-weight:700;color:\${matchColor};">\${match}% match</div>
        <div class="match-bar" style="width:70px;margin-top:4px;margin-left:auto;">
          <div class="match-fill" style="width:\${match}%;background:\${matchColor};"></div>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
      <a href="\${job.url}" target="_blank" class="btn btn-outline btn-sm"><i class="fas fa-external-link-alt"></i> View</a>
      \${!isApplied ? '<button class="btn btn-primary btn-sm" onclick="openApplyModal('+idx+')"><i class="fas fa-paper-plane"></i> Apply</button>' : '<button class="btn btn-success btn-sm" disabled><i class="fas fa-check"></i> Applied</button>'}
      <button class="btn btn-sm \${isSaved?'btn-warning':'btn-outline'}" onclick="toggleSave(\${idx})"><i class="fas fa-bookmark"></i> \${isSaved?'Unsave':'Save'}</button>
    </div>
  </div>\`;
}

function filterJobs() {
  const typeFilter = document.getElementById('filterType').value;
  const sortBy = document.getElementById('sortBy').value;
  const cvMatch = document.getElementById('cvMatchToggle').checked;
  let jobs = [...state.jobs];

  if (typeFilter) jobs = jobs.filter(j => j.type === typeFilter || j.location?.toLowerCase().includes(typeFilter.toLowerCase()));
  if (cvMatch && state.cvJobTitles.length > 0) {
    jobs = jobs.filter(j => state.cvJobTitles.some(t => j.title.toLowerCase().includes(t.toLowerCase().split(' ').pop() || '')));
  }
  if (sortBy === 'recent') jobs.sort((a,b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  else if (sortBy === 'match') jobs.sort((a,b) => (b.matchScore||0) - (a.matchScore||0));
  else if (sortBy === 'company') jobs.sort((a,b) => a.company.localeCompare(b.company));

  state.filteredJobs = jobs;
  const listEl = document.getElementById('jobList');
  if (listEl) listEl.innerHTML = jobs.map((j,i) => renderJobCard(j,i)).join('');
}

function timeSince(dateStr) {
  if (!dateStr) return 'Recently';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}

// ─── Save / Apply ─────────────────────────────────────────────────────────────
function toggleSave(idx) {
  const job = state.filteredJobs[idx] || state.jobs[idx];
  if (!job) return;
  const si = state.savedJobs.findIndex(j => j.id === job.id);
  if (si >= 0) { state.savedJobs.splice(si, 1); notify('Job removed from saved', 'info'); }
  else { state.savedJobs.push(job); notify('Job saved!', 'success'); }
  saveState();
  updateStats();
  renderSavedJobs();
  filterJobs();
}

function saveAllJobs() {
  state.savedJobs = [...state.jobs];
  saveState();
  updateStats();
  renderSavedJobs();
  notify(\`All \${state.jobs.length} jobs saved!\`, 'success');
}

function openApplyModal(idx) {
  const job = state.filteredJobs[idx] || state.jobs[idx];
  if (!job) return;
  const questions = ['Tell me about yourself', 'Why are you interested in this role?', 'What is your greatest strength?', 'What is your expected salary?', 'When can you start?'];
  const aiMode = document.getElementById('aiAnswerMode')?.checked ?? true;

  document.getElementById('applyModalContent').innerHTML = \`
    <div style="margin-bottom:16px;background:#f8fafc;border-radius:10px;padding:14px;">
      <div style="font-weight:700;font-size:16px;">\${job.title}</div>
      <div style="color:#64748b;font-size:13px;margin-top:4px;"><i class="fas fa-building"></i> \${job.company} | <i class="fas fa-map-marker-alt"></i> \${job.location}</div>
    </div>
    <div id="applicationQuestions">
      \${questions.map((q, qi) => \`
        <div style="margin-bottom:16px;">
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">Q\${qi+1}: \${q.toUpperCase()}</label>
          <textarea class="input" id="appAns_\${qi}" rows="3" placeholder="Your answer...">\${aiMode ? '' : ''}</textarea>
          \${aiMode ? '<button class="btn btn-outline btn-sm" style="margin-top:6px;" onclick="fillAIAnswer('+qi+',\\'' + q.replace(/'/g,"\\'") + '\\',\\'' + job.title + '\\',\\'' + job.company + '\\')"><i class="fas fa-magic"></i> AI Generate</button>' : ''}
        </div>\`).join('')}
    </div>
    <button class="btn btn-success" style="width:100%;justify-content:center;" onclick="submitApplication(\${idx})">
      <i class="fas fa-paper-plane"></i> Submit Application
    </button>\`;

  document.getElementById('applyModal').classList.add('open');
  if (aiMode) setTimeout(() => autoFillAnswers(questions, job), 500);
}

async function autoFillAnswers(questions, job) {
  for (let i = 0; i < questions.length; i++) {
    try {
      const res = await axios.post('/api/ai/generate-answer', {
        question: questions[i], cvText: state.cvText, jobTitle: job.title, company: job.company
      });
      const el = document.getElementById('appAns_'+i);
      if (el) el.value = res.data.answer;
    } catch(e) {}
  }
}

async function fillAIAnswer(qi, question, jobTitle, company) {
  const el = document.getElementById('appAns_'+qi);
  if (!el) return;
  el.value = 'Generating...';
  try {
    const res = await axios.post('/api/ai/generate-answer', {
      question, cvText: state.cvText, jobTitle, company
    });
    el.value = res.data.answer;
  } catch(e) { el.value = ''; }
}

async function submitApplication(idx) {
  const job = state.filteredJobs[idx] || state.jobs[idx];
  if (!job) return;
  const answers = [];
  const qEls = document.querySelectorAll('#applicationQuestions textarea');
  qEls.forEach((el, i) => answers.push(el.value));

  try {
    const res = await axios.post('/api/jobs/apply', {
      jobId: job.id, jobTitle: job.title, company: job.company,
      cvText: state.cvText, answers
    });
    const { application } = res.data;
    state.applications.push(application);
    const ji = state.jobs.findIndex(j => j.id === job.id);
    if (ji >= 0) state.jobs[ji].applied = true;
    saveState();
    updateStats();
    addActivity(\`Applied to \${job.title} at \${job.company}\`, 'apply');
    closeModal('applyModal');
    notify(\`✅ Applied to \${job.title} at \${job.company}!\`, 'success');
    filterJobs();
    updateApplicationQueue();
  } catch(e) {
    notify('Application failed: ' + (e.message || 'Unknown error'), 'error');
  }
}

// ─── Auto Apply ───────────────────────────────────────────────────────────────
let autoApplyInterval = null;
async function startAutoApply() {
  if (!state.jobs.length) { notify('No jobs found. Search first!', 'warning'); return; }
  const max = parseInt(document.getElementById('maxApply').value) || 10;
  const minScore = parseInt(document.getElementById('minScore').value) || 70;
  const skipApplied = document.getElementById('skipApplied').checked;

  const eligibleJobs = state.jobs.filter(j => {
    if (skipApplied && state.applications.some(a => a.jobId === j.id)) return false;
    return (j.matchScore || 75) >= minScore;
  }).slice(0, max);

  if (!eligibleJobs.length) { notify('No eligible jobs for auto-apply with current settings', 'warning'); return; }

  state.autoApplying = true;
  document.getElementById('autoApplyBtn').style.display = 'none';
  document.getElementById('stopApplyBtn').style.display = 'flex';
  document.getElementById('applyTotal').textContent = '/ ' + eligibleJobs.length + ' total';

  updateApplicationQueue(eligibleJobs);

  let applied = 0;
  for (const job of eligibleJobs) {
    if (!state.autoApplying) break;
    document.getElementById('applyProgress').innerHTML = \`<div style="color:#0077b5;font-weight:600;"><i class="fas fa-spinner fa-spin"></i> Applying to \${job.title} at \${job.company}...</div>\`;

    try {
      const aiAnswers = await generateAutoAnswers(job);
      const res = await axios.post('/api/jobs/apply', {
        jobId: job.id, jobTitle: job.title, company: job.company,
        cvText: state.cvText, answers: aiAnswers
      });
      state.applications.push(res.data.application);
      const ji = state.jobs.findIndex(j => j.id === job.id);
      if (ji >= 0) state.jobs[ji].applied = true;
      applied++;
      document.getElementById('applyCount').textContent = applied + ' applied';
      const pct = Math.round((applied / eligibleJobs.length) * 100);
      document.getElementById('applyProgressBar').style.width = pct + '%';
      addActivity(\`Auto-applied to \${job.title} at \${job.company}\`, 'apply');
      updateApplicationQueue(eligibleJobs);
      saveState(); updateStats();
    } catch(e) {}

    await sleep(1500 + Math.random() * 1000);
  }

  stopAutoApply();
  notify(\`✅ Auto-apply complete! Applied to \${applied} jobs.\`, 'success');
  if (document.getElementById('autoGithub').checked) saveToGithub('structure');
}

async function generateAutoAnswers(job) {
  const questions = ['Tell me about yourself', 'Why are you interested in this role?', 'What is your greatest strength?', 'What is your expected salary?', 'When can you start?'];
  const answers = [];
  for (const q of questions) {
    try {
      const res = await axios.post('/api/ai/generate-answer', {
        question: q, cvText: state.cvText, jobTitle: job.title, company: job.company
      });
      answers.push(res.data.answer);
    } catch(e) { answers.push(''); }
  }
  return answers;
}

function stopAutoApply() {
  state.autoApplying = false;
  document.getElementById('autoApplyBtn').style.display = 'flex';
  document.getElementById('stopApplyBtn').style.display = 'none';
  document.getElementById('applyProgress').innerHTML = '<div style="color:#059669;font-weight:600;"><i class="fas fa-check-circle"></i> Done</div>';
}

function updateApplicationQueue(jobs) {
  const queue = jobs || state.jobs.slice(0, 10);
  const el = document.getElementById('applicationQueue');
  if (!queue.length) return;
  el.innerHTML = queue.map(j => {
    const isApplied = state.applications.some(a => a.jobId === j.id);
    return \`<div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:8px;background:\${isApplied?'#f0fdf4':'#fff'};">
      <i class="fas fa-\${isApplied?'check-circle':'clock'}" style="color:\${isApplied?'#059669':'#94a3b8'};font-size:18px;"></i>
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;">\${j.title}</div>
        <div style="font-size:12px;color:#64748b;">\${j.company} | \${j.location}</div>
      </div>
      <span class="badge \${isApplied?'badge-green':'badge-gray'}">\${isApplied?'Applied':'Pending'}</span>
    </div>\`;
  }).join('');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── CV ───────────────────────────────────────────────────────────────────────
function handleDragOver(e) { e.preventDefault(); document.getElementById('dropZone').classList.add('drag-over'); }
function handleDragLeave(e) { document.getElementById('dropZone').classList.remove('drag-over'); }
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}
function handleFileSelect(e) { const file = e.target.files[0]; if (file) processFile(file); }

function processFile(file) {
  const dz = document.getElementById('dropZone');
  dz.classList.add('has-file');
  document.getElementById('dropContent').innerHTML = \`
    <i class="fas fa-file-check" style="font-size:48px;color:#059669;margin-bottom:16px;"></i>
    <h3 style="font-size:16px;font-weight:700;color:#059669;">\${file.name}</h3>
    <p style="font-size:13px;color:#64748b;margin-top:8px;">\${(file.size/1024).toFixed(1)} KB - Click to change</p>\`;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    document.getElementById('cvTextInput').value = text;
    state.cvText = text;
    notify('CV uploaded successfully!', 'success');
  };
  if (file.type === 'application/pdf') {
    reader.readAsText(file);
  } else {
    reader.readAsText(file);
  }
}

async function analyzeCV() {
  const text = document.getElementById('cvTextInput').value.trim();
  if (!text) { notify('Please upload or paste your CV first', 'warning'); return; }
  state.cvText = text;

  try {
    const res = await axios.post('/api/cv/analyze', { cvText: text });
    const { skills, experience, education, jobTitles, summary } = res.data;
    state.cvSkills = skills;
    state.cvJobTitles = jobTitles;
    saveState();

    const card = document.getElementById('cvAnalysisCard');
    card.style.display = 'block';
    document.getElementById('cvAnalysisContent').innerHTML = \`
      <div style="background:#f0fdf4;border-radius:10px;padding:14px;margin-bottom:16px;">
        <div style="font-weight:700;font-size:14px;color:#166534;margin-bottom:4px;"><i class="fas fa-user"></i> Summary</div>
        <p style="font-size:13px;color:#166534;">\${summary}</p>
      </div>
      <div style="margin-bottom:14px;">
        <div style="font-weight:700;font-size:13px;color:#64748b;margin-bottom:8px;">EXPERIENCE LEVEL</div>
        <span class="badge badge-purple"><i class="fas fa-briefcase"></i> \${experience}</span>
      </div>
      <div style="margin-bottom:14px;">
        <div style="font-weight:700;font-size:13px;color:#64748b;margin-bottom:8px;">EDUCATION</div>
        <span class="badge badge-blue"><i class="fas fa-graduation-cap"></i> \${education}</span>
      </div>
      <div style="margin-bottom:14px;">
        <div style="font-weight:700;font-size:13px;color:#64748b;margin-bottom:8px;">SKILLS (\${skills.length})</div>
        <div>\${skills.map(s => '<span class="skill-tag">'+s+'</span>').join('')}</div>
      </div>
      <div style="margin-bottom:14px;">
        <div style="font-weight:700;font-size:13px;color:#64748b;margin-bottom:8px;">SUGGESTED JOB TITLES</div>
        <div>\${jobTitles.map(t => '<span class="badge badge-green" style="margin:2px;cursor:pointer;" onclick="quickSearch(\\'' + t.replace(/'/g,"\\'") + '\\')">'+t+'</span>').join('')}</div>
      </div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="searchByCVTitles()">
        <i class="fas fa-search"></i> Search Jobs by CV
      </button>\`;

    notify('CV analyzed successfully! ' + skills.length + ' skills found.', 'success');
    addActivity('CV analyzed - ' + skills.length + ' skills detected', 'cv');
  } catch(e) {
    notify('Analysis failed: ' + (e.message || 'Unknown error'), 'error');
  }
}

function quickSearch(title) {
  document.getElementById('searchTitle').value = title;
  showSection('search');
  searchJobs();
}

function searchByCVTitles() {
  if (!state.cvJobTitles.length) return;
  document.getElementById('searchTitle').value = state.cvJobTitles[0];
  showSection('search');
  searchJobs();
}

// ─── AI Assistant ──────────────────────────────────────────────────────────────
async function generateAnswer() {
  const question = document.getElementById('aiQuestion').value.trim();
  const jobTitle = document.getElementById('aiJobTitle').value.trim();
  const company = document.getElementById('aiCompany').value.trim();
  if (!question) { notify('Please enter a question', 'warning'); return; }

  const btn = document.getElementById('generateBtn');
  btn.innerHTML = '<span class="spinner"></span> Generating...';
  btn.disabled = true;

  const responseArea = document.getElementById('aiResponseArea');
  responseArea.innerHTML = \`<div class="ai-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>\`;

  try {
    const res = await axios.post('/api/ai/generate-answer', {
      question, cvText: state.cvText, jobTitle, company
    });
    const { answer, confidence } = res.data;

    responseArea.innerHTML = \`
      <div class="ai-bubble">\${answer}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;">
        <span style="font-size:12px;color:#64748b;"><i class="fas fa-chart-line"></i> Confidence: \${confidence}%</span>
        <button class="btn btn-outline btn-sm" onclick="copyToClipboard(this, \\\`\${answer.replace(/\`/g, "'")}\\\`)"><i class="fas fa-copy"></i> Copy</button>
      </div>\`;

    state.answerHistory.unshift({ question, answer, jobTitle, company, timestamp: new Date().toISOString() });
    if (state.answerHistory.length > 20) state.answerHistory.pop();
    saveState();
    renderAnswerHistory();
  } catch(e) {
    responseArea.innerHTML = '<div style="color:#ef4444;padding:20px;">Failed to generate answer.</div>';
    notify('Generation failed', 'error');
  }

  btn.innerHTML = '<i class="fas fa-magic"></i> Generate Answer';
  btn.disabled = false;
}

function renderAnswerHistory() {
  const el = document.getElementById('answerHistory');
  if (!state.answerHistory.length) return;
  el.innerHTML = state.answerHistory.slice(0, 5).map(h => \`
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:10px;">
      <div style="font-weight:700;font-size:13px;color:#1a202c;">\${h.question}</div>
      \${h.jobTitle ? '<div style="font-size:11px;color:#64748b;margin-top:2px;">'+h.jobTitle+' @ '+(h.company||'Company')+'</div>' : ''}
      <div style="font-size:13px;color:#64748b;margin-top:8px;line-height:1.5;">\${h.answer.substring(0,150)}...</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:6px;">\${new Date(h.timestamp).toLocaleString()}</div>
    </div>\`).join('');
}

function copyToClipboard(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    setTimeout(() => btn.innerHTML = '<i class="fas fa-copy"></i> Copy', 2000);
  });
}

// ─── GitHub ───────────────────────────────────────────────────────────────────
function togglePATVisibility() {
  const input = document.getElementById('ghPAT');
  const icon = document.getElementById('patEyeIcon');
  if (input.type === 'password') { input.type = 'text'; icon.className = 'fas fa-eye-slash'; }
  else { input.type = 'password'; icon.className = 'fas fa-eye'; }
}

async function validateGitHub() {
  const pat = document.getElementById('ghPAT').value.trim();
  if (!pat) { notify('Please enter your GitHub PAT', 'warning'); return; }
  const btn = document.getElementById('ghConnectBtn');
  btn.innerHTML = '<span class="spinner"></span> Connecting...';
  btn.disabled = true;

  try {
    const res = await axios.post('/api/github/validate', { pat });
    state.github = { connected: true, pat, username: res.data.username, name: res.data.name, repos: [] };
    saveState();
    showGithubUser(res.data);
    logSync('✅ Connected as ' + res.data.username);
    notify('GitHub connected as ' + res.data.username + '!', 'success');
    fetchRepos();
  } catch(e) {
    notify('Invalid GitHub PAT. Check your token.', 'error');
    logSync('❌ Connection failed - invalid PAT');
  }

  btn.innerHTML = '<i class="fab fa-github"></i> Connect';
  btn.disabled = false;
}

function showGithubUser(data) {
  const d = data || state.github;
  document.getElementById('ghUserCard').style.display = 'block';
  document.getElementById('ghUsername').textContent = '@' + (d.username || state.github.username);
  document.getElementById('ghName').textContent = d.name || '';
  if (d.avatar) document.getElementById('ghAvatar').src = d.avatar;
  document.getElementById('ghUserInfo').style.display = 'block';
  document.getElementById('ghUserInfo').textContent = '🐙 @' + (d.username || state.github.username);
}

async function fetchRepos() {
  try {
    const res = await axios.post('/api/github/repos', { pat: state.github.pat });
    state.github.repos = res.data.repos;
    saveState();
    renderRepoSelection();
  } catch(e) {}
}

function renderRepoSelection() {
  const el = document.getElementById('repoSelection');
  el.innerHTML = \`
    <div>
      <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;">SELECT EXISTING REPOSITORY</label>
      <select class="input" id="repoSelect" onchange="selectRepo(this.value)">
        <option value="">-- Choose a repository --</option>
        \${state.github.repos.map(r => '<option value="'+r.full_name+'">'+r.name+(r.private?' 🔒':' 🌐')+'</option>').join('')}
      </select>
      \${state.github.selectedRepo ? '<div style="margin-top:8px;" class="badge badge-green"><i class="fas fa-check"></i> ' + state.github.selectedRepo + '</div>' : ''}
    </div>\`;
}

function selectRepo(fullName) {
  state.github.selectedRepo = fullName;
  saveState();
  if (fullName) { notify('Repository selected: ' + fullName, 'success'); logSync('📁 Selected repo: ' + fullName); }
}

async function createRepo() {
  if (!state.github.connected) { notify('Connect GitHub first', 'warning'); return; }
  const name = document.getElementById('newRepoName').value.trim();
  if (!name) { notify('Enter repository name', 'warning'); return; }
  const btn = document.getElementById('createRepoBtn');
  btn.innerHTML = '<span class="spinner"></span> Creating...';
  btn.disabled = true;

  try {
    const res = await axios.post('/api/github/create-repo', {
      pat: state.github.pat,
      repoName: name,
      description: document.getElementById('newRepoDesc').value || 'LinkedIn Job Bot Results',
      isPrivate: document.getElementById('newRepoPrivate').checked
    });
    const { repo } = res.data;
    state.github.repos.unshift({ name: repo.name, full_name: repo.full_name, url: repo.url });
    state.github.selectedRepo = repo.full_name;
    saveState();
    renderRepoSelection();
    document.getElementById('repoSelect').value = repo.full_name;
    notify('Repository "' + repo.name + '" created!', 'success');
    logSync('🆕 Created repo: ' + repo.full_name);
    addActivity('Created GitHub repo: ' + repo.name, 'github');
  } catch(e) {
    notify('Failed: ' + (e.response?.data?.error || e.message), 'error');
    logSync('❌ Repo creation failed');
  }

  btn.innerHTML = '<i class="fas fa-plus"></i> Create Repository';
  btn.disabled = false;
}

async function saveToGithub(type) {
  if (!state.github.connected) { notify('Connect GitHub first in the GitHub Sync tab', 'warning'); showSection('github'); return; }
  if (!state.github.selectedRepo) { notify('Select a repository first', 'warning'); showSection('github'); return; }

  logSync('💾 Saving ' + type + ' to GitHub...');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

  try {
    if (type === 'structure') {
      const res = await axios.post('/api/github/save-structure', {
        pat: state.github.pat,
        repoFullName: state.github.selectedRepo,
        jobs: state.jobs,
        applications: state.applications,
        sessionId: ts
      });
      logSync('✅ Full structure saved! Files: ' + res.data.savedFiles.map(f => f.path).join(', '));
      notify('Full bot structure saved to GitHub!', 'success');
      addActivity('Saved full structure to GitHub', 'github');
    } else if (type === 'jobs') {
      const content = JSON.stringify({ timestamp: new Date().toISOString(), totalJobs: state.jobs.length, jobs: state.jobs }, null, 2);
      await axios.post('/api/github/save', {
        pat: state.github.pat, repoFullName: state.github.selectedRepo,
        filename: 'jobs/jobs_' + ts + '.json', content,
        commitMessage: 'Add job results - ' + state.jobs.length + ' jobs'
      });
      logSync('✅ Jobs saved to jobs/jobs_' + ts + '.json');
      notify('Jobs saved to GitHub!', 'success');
    } else if (type === 'applications') {
      const content = JSON.stringify({ timestamp: new Date().toISOString(), totalApplications: state.applications.length, applications: state.applications }, null, 2);
      await axios.post('/api/github/save', {
        pat: state.github.pat, repoFullName: state.github.selectedRepo,
        filename: 'applications/applications_' + ts + '.json', content,
        commitMessage: 'Add applications - ' + state.applications.length + ' submitted'
      });
      logSync('✅ Applications saved to applications/applications_' + ts + '.json');
      notify('Applications saved to GitHub!', 'success');
    }
  } catch(e) {
    logSync('❌ Save failed: ' + (e.response?.data?.error || e.message));
    notify('Save failed: ' + (e.response?.data?.error || e.message), 'error');
  }
}

async function saveCustomFile() {
  if (!state.github.connected || !state.github.selectedRepo) {
    notify('Connect GitHub and select repo first', 'warning'); return;
  }
  const filename = document.getElementById('customFilename').value.trim();
  if (!filename) { notify('Enter filename', 'warning'); return; }
  const content = JSON.stringify({
    timestamp: new Date().toISOString(),
    jobs: state.jobs,
    applications: state.applications,
    savedJobs: state.savedJobs
  }, null, 2);
  try {
    await axios.post('/api/github/save', {
      pat: state.github.pat, repoFullName: state.github.selectedRepo,
      filename, content, commitMessage: 'Save custom export: ' + filename
    });
    logSync('✅ Custom file saved: ' + filename);
    notify('File saved: ' + filename, 'success');
  } catch(e) {
    notify('Save failed', 'error');
  }
}

function logSync(msg) {
  const log = document.getElementById('syncLog');
  const line = document.createElement('div');
  line.style.color = msg.startsWith('✅') ? '#4ade80' : msg.startsWith('❌') ? '#f87171' : '#94a3b8';
  line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// ─── Apply All / Batch ────────────────────────────────────────────────────────
async function applyAllJobs() {
  showSection('apply');
  setTimeout(startAutoApply, 500);
}

// ─── Stats & Activity ─────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-found').textContent = state.jobs.length;
  document.getElementById('stat-saved').textContent = state.savedJobs.length;
  document.getElementById('stat-applied').textContent = state.applications.length;
  document.getElementById('stat-responses').textContent = Math.floor(state.applications.length * 0.3);
}

function addActivity(msg, type) {
  const icons = { search:'search', apply:'paper-plane', cv:'file-user', github:'github' };
  const colors = { search:'#0077b5', apply:'#059669', cv:'#7c3aed', github:'#1a202c' };
  state.activity.unshift({ msg, type, timestamp: new Date().toISOString() });
  if (state.activity.length > 20) state.activity.pop();
  saveState();
  renderActivity();
}

function renderActivity() {
  const el = document.getElementById('recentActivity');
  if (!state.activity.length) return;
  el.innerHTML = state.activity.slice(0,8).map(a => \`
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;">
      <i class="fas fa-\${a.type==='search'?'search':a.type==='apply'?'paper-plane':a.type==='cv'?'file-alt':'github'}" style="color:#0077b5;font-size:13px;width:16px;text-align:center;"></i>
      <div style="flex:1;font-size:13px;">\${a.msg}</div>
      <div style="font-size:11px;color:#94a3b8;">\${timeSince(a.timestamp)}</div>
    </div>\`).join('');
}

function renderSavedJobs() {
  const el = document.getElementById('savedJobsList');
  if (!state.savedJobs.length) return;
  el.innerHTML = state.savedJobs.slice(0,5).map((j,i) => \`
    <div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:8px;">
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;">\${j.title}</div>
        <div style="font-size:12px;color:#64748b;">\${j.company} | \${j.location}</div>
      </div>
      <a href="\${j.url}" target="_blank" class="btn btn-outline btn-sm"><i class="fas fa-external-link-alt"></i></a>
    </div>\`).join('');
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function saveSettings() {
  const prefs = {
    defaultTitle: document.getElementById('settDefaultTitle').value,
    defaultLocation: document.getElementById('settDefaultLocation').value,
  };
  if (prefs.defaultTitle) document.getElementById('searchTitle').value = prefs.defaultTitle;
  if (prefs.defaultLocation) document.getElementById('searchLocation').value = prefs.defaultLocation;
  localStorage.setItem('ljb_prefs', JSON.stringify(prefs));
  notify('Settings saved!', 'success');
}

function exportData() {
  const data = JSON.stringify({ jobs: state.jobs, applications: state.applications, savedJobs: state.savedJobs, answerHistory: state.answerHistory }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'linkedin-bot-data.json'; a.click();
  notify('Data exported!', 'success');
}

function clearJobs() { if (confirm('Clear all job results?')) { state.jobs = []; state.filteredJobs = []; saveState(); updateStats(); notify('Jobs cleared', 'info'); } }
function clearAllData() {
  if (confirm('Clear ALL data? This cannot be undone!')) {
    Object.assign(state, { jobs:[], filteredJobs:[], applications:[], savedJobs:[], cvText:'', cvSkills:[], cvJobTitles:[], answerHistory:[], activity:[] });
    saveState(); updateStats(); notify('All data cleared', 'info');
  }
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); }
});
loadState();
renderAnswerHistory();
</script>
</body>
</html>`
}

export default app
