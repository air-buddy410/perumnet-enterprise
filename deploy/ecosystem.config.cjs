module.exports = {
  apps: [
    {
      name: "perumnet-enterprise",
      cwd: "/var/www/perumnet-enterprise",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3100",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "700M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "perumnet-enterprise-email-worker",
      cwd: "/var/www/perumnet-enterprise",
      script: "scripts/email-worker.mjs",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: "180M",
      env: {
        NODE_ENV: "production",
        EMAIL_ENV_FILE: ".env.production",
      },
    },
  ],
};
