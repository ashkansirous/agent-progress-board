/* global process */
// Shared by the plugin script tests: a fake board over local HTTP and a way to run a script as a child process.
// The real board and a real token are never touched (env values and temp folders only).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';

export const TEST_TOKEN = 'test-token-not-real';
const TEMP_FOLDERS = [];

// A temp folder the test file removes when it finishes.
export function trackedTemp(prefix) {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  TEMP_FOLDERS.push(folder);
  return folder;
}

export function removeTrackedTemps() {
  for (const folder of TEMP_FOLDERS.splice(0)) rmSync(folder, { recursive: true, force: true });
}

export function cleanUpAfterTests() {
  after(removeTrackedTemps);
}

export function startFakeBoard(handler = replyOk) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const record = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
      requests.push(record);
      handler(record, res);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` });
  }));
}

export function replyOk(record, res) {
  const text = JSON.stringify({ key: record.body.params.arguments.key });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } }));
}

// The tool calls a fake board received, as { tool, args }.
export function callsOf(board) {
  return board.requests.map((request) => ({ tool: request.body.params.name, args: request.body.params.arguments }));
}

// A child's environment: the plugin's option variables point at the fake board, state goes to `stateFolder`.
export function envFor(url, stateFolder, extra = {}) {
  const env = { ...process.env, AGENT_BOARD_PROJECT: 'demo-app', AGENT_BOARD_SESSION_ROOT: stateFolder, ...extra };
  for (const name of ['AGENT_BOARD_URL', 'AGENT_BOARD_TOKEN', 'AGENT_BOARD_ENV', 'AGENT_BOARD_MODEL', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PLUGIN_DATA']) delete env[name];
  return { ...env, CLAUDE_PLUGIN_OPTION_BOARD_URL: url, CLAUDE_PLUGIN_OPTION_BOARD_TOKEN: TEST_TOKEN, ...extra };
}

export function runNode(file, args, env, stdin = '') {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [file, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(stdin);
  });
}
