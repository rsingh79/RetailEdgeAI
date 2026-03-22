const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '.logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

const serverOut = fs.openSync(path.join(logDir, 'server.log'), 'w');
const serverErr = fs.openSync(path.join(logDir, 'server-err.log'), 'w');
const clientOut = fs.openSync(path.join(logDir, 'client.log'), 'w');
const clientErr = fs.openSync(path.join(logDir, 'client-err.log'), 'w');

const server = spawn('node', ['--watch', 'src/app.js'], {
  cwd: path.join(__dirname, 'server'),
  windowsHide: true,
  detached: true,
  stdio: ['ignore', serverOut, serverErr],
});

const client = spawn('node', ['node_modules/vite/bin/vite.js', '--port', '5174'], {
  cwd: path.join(__dirname, 'client'),
  windowsHide: true,
  detached: true,
  stdio: ['ignore', clientOut, clientErr],
});

server.unref();
client.unref();

console.log(`Server started (PID ${server.pid}) on port 3001`);
console.log(`Client started (PID ${client.pid}) on port 5174`);
console.log(`Logs in ${logDir}`);
