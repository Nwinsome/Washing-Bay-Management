const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const root = path.join(__dirname, '..');
const children = new Set();
let stopping = false;
let pollTimer;
let deadlineTimer;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(pollTimer);
  clearTimeout(deadlineTimer);
  process.exitCode = code;
  for (const child of children) {
    if (process.platform === 'win32') {
      // Terminate the child tree, including Vite's build helper processes.
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore', windowsHide: true,
      });
      killer.on('error', () => child.kill());
    } else {
      child.kill('SIGTERM');
    }
  }
}

function launch(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  children.add(child);
  child.on('error', (error) => {
    children.delete(child);
    console.error(`Could not start ${command}: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      if (signal || code !== 0) console.error(`Child process stopped (${signal ?? code}).`);
      stop(signal ? 1 : (code ?? 1));
    }
  });
  return child;
}

function waitForVite() {
  if (stopping) return;
  const request = http.get('http://localhost:5173/', (response) => {
    response.resume();
    if (stopping) return;
    if (response.statusCode === 200) {
      clearTimeout(deadlineTimer);
      console.log('Vite is ready. Starting Electron in development mode.');
      launch(require('electron'), ['.', '--dev']);
    } else {
      pollTimer = setTimeout(waitForVite, 250);
    }
  });
  request.setTimeout(1000, () => request.destroy());
  request.on('error', () => {
    if (!stopping) pollTimer = setTimeout(waitForVite, 250);
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

// Reject an occupied port instead of opening an unrelated existing server.
const probe = net.createServer();
probe.on('error', (error) => {
  console.error(`Cannot use localhost:5173: ${error.message}. Close the server using that port and retry.`);
  stop(1);
});
probe.listen(5173, 'localhost', () => {
  probe.close(() => {
    if (stopping) return;
    const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
    launch(process.execPath, [viteCli, '--host', 'localhost', '--port', '5173', '--strictPort']);
    deadlineTimer = setTimeout(() => {
      console.error('Vite did not become ready within 30 seconds. Check the errors above.');
      stop(1);
    }, 30000);
    waitForVite();
  });
});
