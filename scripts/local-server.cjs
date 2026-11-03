const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

async function startTestServer(savedRooms) {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-test-'));
  const store = path.join(dir, 'rooms.json');
  if (savedRooms) fs.writeFileSync(store, JSON.stringify({ rooms: savedRooms }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), ROOM_STORE_PATH: store },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes('running at')) { clearTimeout(timer); resolve(); }
    });
  });
  return { url: `http://localhost:${port}`, store, async stop() {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
    if (stderr) throw new Error(stderr);
  } };
}
module.exports = { startTestServer };
