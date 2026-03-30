module.exports = {
  apps: [
    {
      name: 'retailedge-api',
      script: 'src/app.js',
      cwd: '/root/retailedgeai/server',
      interpreter: 'node',
      interpreter_args: '--env-file=/root/retailedgeai/server/.env',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        COHERE_API_KEY: process.env.COHERE_API_KEY || '',
      },
    },
  ],
};
