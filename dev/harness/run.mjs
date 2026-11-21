// npm run harness: vite build --watch (harness client) + tsx watch (harness server).
import { spawn } from 'node:child_process';

const procs = [
  spawn('npx', ['vite', 'build', '--watch', '--config', 'dev/harness/vite.harness.config.ts'], { stdio: 'inherit' }),
  spawn('npx', ['tsx', 'watch', '--clear-screen=false', 'dev/harness/server.ts'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
