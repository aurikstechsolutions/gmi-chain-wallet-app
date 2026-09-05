/**
 * PM2 Cluster Config — 8 vCPU / 24 GB RAM
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup   (run the printed command to auto-start on reboot)
 */

module.exports = {
  apps: [
    {
      name: "mchain-api",
      script: "./artifacts/api-server/dist/index.mjs",
      cwd: "/var/www/mchain",

      // Cluster mode: one worker per vCPU
      exec_mode: "cluster",
      instances: 8,

      // Restart if a worker exceeds 1.5 GB RAM
      max_memory_restart: "1500M",

      // Environment
      env_production: {
        NODE_ENV: "production",
        PORT: 8080,
        // Set these in your actual environment or .env file — don't hardcode secrets
        // DATABASE_URL: "postgresql://user:pass@127.0.0.1:6432/mchain",  // 6432 = PgBouncer
        // REDIS_URL: "redis://127.0.0.1:6379",
        // ADMIN_SECRET: "...",
        // P2P_ESCROW_ADDRESS: "...",
        // P2P_ESCROW_PRIVATE_KEY: "...",
      },

      // Logs
      out_file: "/var/log/mchain/api-out.log",
      error_file: "/var/log/mchain/api-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      exp_backoff_restart_delay: 100,
    },
  ],
};
