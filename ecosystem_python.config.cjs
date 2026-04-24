module.exports = {
  apps: [
    {
      name: 'linkedin-job-bot-python',
      script: 'python3',
      args: 'app.py',
      cwd: '/home/user/webapp',
      env: { PORT: 5000, FLASK_ENV: 'production' },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 2000,
      max_restarts: 5
    }
  ]
}
