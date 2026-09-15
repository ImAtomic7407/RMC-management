module.exports = {
  apps: [
    {
      name: 'rmc-server',
      script: './server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 8080,
        SESSION_STORE: 'memory',
        ALLOW_UNSAFE_DEPLOY_STORAGE: 'true'
      }
    },
    {
      name: 'rmc-tunnel',
      script: './cloudflared.exe',
      args: '--config config_rmc.yml tunnel run rmc-login-v2',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      interpreter: 'none'
    },
    {
      name: 'n8n',
      script: 'A:\\RMC_Local_Installer\\n8n_runtime\\node_modules\\n8n\\bin\\n8n',
      cwd: 'A:\\RMC_Local_Installer\\n8n_runtime',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      interpreter: 'A:\\RMC_Local_Installer\\n8n_runtime\\node-v22.13.1-win-x64\\node.exe',
      env: {
        N8N_PORT: 5678,
        N8N_PROTOCOL: 'http',
        N8N_HOST: 'localhost',
        N8N_USER_FOLDER: 'A:\\RMC_Local_Installer\\n8n_runtime',
        N8N_RUNNERS_MODE: 'external',
        N8N_RUNNERS_AUTH_TOKEN: 'local-dev-token',
        DB_SQLITE_DATABASE: 'A:\\RMC_Local_Installer\\n8n_runtime\\n8n.sqlite'
      }
    },
    {
      name: 'absentee-monitor',
      script: 'A:\\RMC_Local_Installer\\payload\\absentee_monitor.py',
      cwd: 'A:\\RMC_Local_Installer\\payload',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      interpreter: 'C:\\Python314\\python.exe',
      env: {
        SMS8_API_URL: 'https://app.sms8.io/services/send.php',
        SMS8_API_KEY: '506877730eb3e068ce3f279d515419f0fda4f0b9',
        SMS8_DEVICE_IDS: '10172',
        SMS8_USE_RANDOM_DEVICE: '1',
        ABSENTEE_POLL_INTERVAL_SECONDS: 5
      }
    }
  ]
};
