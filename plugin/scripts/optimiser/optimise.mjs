#!/usr/bin/env node
/* global process, setTimeout */
// The process optimiser's script (Slice 57): reads a week of finished steps from the board (`query_runs`), runs the
// detectors on each project's rows and writes the weekly report card. Dry run by default: no finding card is filed
// unless --file-findings is given (Decision 10). Fails open like every plugin client: a missing board address or token,
// an unreadable config, a timeout or a refused call is one stderr line and exit 0.
//
// Usage: node optimise.mjs --config <optimiser config json> [--project <slug>] [--days 7] [--file-findings]
//          [--runs-file <json rows>]  (test seam: rows from a file instead of query_runs)
//          [--now <ISO time>]         (test seam: the clock)
// Board address and token: as report-progress.mjs (plugin options, else AGENT_BOARD_URL / AGENT_BOARD_TOKEN).

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callTool, parseArgs, resolveConfig, sendCardReport, SESSION_VARIABLE, stateRoot } from '../report-progress.mjs';
import { detectAll } from './detectors.mjs';
import { FINDING_KEY_PART, hasCloseMarker, withCloseMarker, findingDetails, findingKey, findingTitle, isoWeek, reportDetails, reportKey, reportOutcome, reportTitle, savingText } from './report.mjs';

export const DEFAULT_DAYS = 7;
export const RUN_LIMIT = 1000; // the board's largest `query_runs` page
const MS_PER_DAY = 86_400_000;
const SENDER = 'optimiser';
const EXIT_DELAY_MS = 100;
const SWITCHES = ['file-findings'];

export const LOG = (line) => process.stderr.write(`optimise: ${line}\n`);

// parseArgs of the reporter treats every flag as taking a value; a switch is read from the raw list.
export function readOptions(argv, env = process.env) {
  const parsed = parseArgs(argv.filter((arg) => !SWITCHES.includes(arg.slice(2))));
  const days = Number(parsed.days || DEFAULT_DAYS);
  return {
    configFile: parsed.config || '',
    project: parsed.project || '',
    days: Number.isFinite(days) && days >= 1 ? Math.floor(days) : DEFAULT_DAYS,
    fileFindings: argv.includes('--file-findings'),
    runsFile: parsed['runs-file'] || '',
    now: parsed.now ? new Date(parsed.now) : new Date(),
    session: env[SESSION_VARIABLE] || '',
  };
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    LOG(`${what} unreadable (${path || 'no path given'}), nothing sent`);
    return null;
  }
}

// The rows of a `query_runs` reply: the list, or null when the call did not give one.
export function rowsOf(outcome) {
  if (!outcome.ok) return null;
  return Array.isArray(outcome.data) ? outcome.data : null;
}

// One `query_runs` read, for one project or (project '') for all: { rows, notice } or null. `notice` is the board's own
// note when it cut the reply (size limit or item limit) or the page came back full: either way the week may hold more
// runs than were read (Review 1).
async function readRuns(options, boardConfig, project) {
  const to = options.now.toISOString();
  const from = new Date(options.now.getTime() - options.days * MS_PER_DAY).toISOString();
  const outcome = await callTool(boardConfig, 'query_runs', { from, to, limit: RUN_LIMIT, ...(project ? { project } : {}) });
  const rows = rowsOf(outcome);
  if (rows === null) {
    LOG(`query_runs skipped${project ? ` for ${project}` : ''} (${outcome.ok ? 'unexpected reply' : outcome.error})`);
    return null;
  }
  const full = rows.length >= RUN_LIMIT ? `${RUN_LIMIT} rows came back, the most the board returns; older runs of the window may be missing` : '';
  return { rows, notice: outcome.notice || full };
}

// The projects to look at: --project, else the config's `projects` list, else the projects one unfiltered read returned
// (Decision 13). `notice` is set when that discovery read was cut or full: a project may be missing from the list, so
// nothing is closed for lack of runs (Decision 14). null when the read failed.
async function projectsToRead(options, boardConfig, optimiserConfig) {
  if (options.project) return { projects: [options.project], notice: '' };
  if (Array.isArray(optimiserConfig.projects) && optimiserConfig.projects.length > 0) return { projects: [...new Set(optimiserConfig.projects.map(String))].sort(), notice: '' };
  const first = await readRuns(options, boardConfig, '');
  if (!first) return null;
  const notice = first.notice ? `the project list is partial (${first.notice}); name the projects in the config's "projects" list` : '';
  if (notice) LOG(notice);
  return { projects: [...new Set(first.rows.map((row) => row.project))].sort(), notice };
}

// A Map of project -> { rows, notice }, each project read on its own with its own row cap, so a busy project never
// shortens a quiet one (Decision 13). A project whose read failed is left out. null when no project list could be had.
async function loadRuns(options, boardConfig, optimiserConfig) {
  const loaded = new Map();
  if (options.runsFile) {
    const rows = readJson(options.runsFile, 'runs file');
    if (!rows) return null;
    const projects = options.project ? [options.project] : [...new Set(rows.map((row) => row.project))].sort();
    for (const project of projects) loaded.set(project, { rows: rows.filter((row) => row.project === project), notice: '' });
    return loaded;
  }
  const found = await projectsToRead(options, boardConfig, optimiserConfig);
  if (!found) return null;
  for (const project of found.projects) {
    const read = await readRuns(options, boardConfig, project);
    if (read) loaded.set(project, { rows: read.rows, notice: read.notice || found.notice });
  }
  return loaded;
}

// One report_progress through the shared sender (never a card report around it).
function send(env, boardConfig, session, args) {
  return sendCardReport(stateRoot(env), SENDER, session, boardConfig, 'report_progress', args);
}

export function reportArgs({ project, week, findings, runCount, dryRun, notice = '' }) {
  return {
    key: reportKey(project, week),
    project,
    type: 'unplanned',
    status: 'done',
    priority: 'P3',
    source: 'agent',
    title: reportTitle(week),
    outcome: reportOutcome(findings.length, dryRun),
    why: 'Weekly look for wasted tokens and time in the recorded runs',
    details_md: reportDetails({ week, findings, runCount, dryRun, notice }),
  };
}

// `isNew` false (the card exists and is open): no status is sent, so the report never changes where the card stands.
export function findingArgs(project, item, isNew = true) {
  return {
    key: findingKey(project, item),
    project,
    type: 'finding',
    ...(isNew ? { status: 'open' } : {}),
    ...(isNew ? { priority: 'P3' } : {}), // an update never resets a priority the owner raised (Review 3)
    source: 'agent',
    title: findingTitle(item),
    why: `Estimated saving: ${savingText(item.saving)}`,
    details_md: findingDetails(item),
  };
}

const NO_SUCH_ITEM = /no item/;

// Where a finding's card stands: 'absent' (file it), 'open' (update it, no status), 'closed-by-script' (done, with the
// script's own close marker in its details: the finding is back, reopen it), 'decided' (done without the marker, or
// archived: the owner's call, leave it) or 'unknown' (the read failed: leave it, never guess) (Decision 14).
async function cardState(boardConfig, key) {
  const read = await callTool(boardConfig, 'get_item', { key, include_archived: true });
  if (!read.ok) return NO_SUCH_ITEM.test(read.error) ? 'absent' : 'unknown';
  const card = read.data || {};
  if (card.archived_at) return 'decided';
  if (card.status !== 'done') return 'open';
  return hasCloseMarker(card.details_md) ? 'closed-by-script' : 'decided';
}

async function fileFinding(env, boardConfig, options, project, item) {
  const state = await cardState(boardConfig, findingKey(project, item));
  if (state === 'decided' || state === 'unknown') return LOG(`finding ${item.detector} for ${project} left as it is (${state})`);
  const filed = await send(env, boardConfig, options.session, findingArgs(project, item, state !== 'open'));
  if (!filed.ok) LOG(`finding ${item.detector} for ${project} skipped (${filed.error})`);
}

// Open finding cards of the project that this week's detectors no longer produce are closed (mark_done). Never when the
// read of the week was partial or the list was cut: a finding missing from partial data is not a finding that went away.
async function closeGone(env, boardConfig, options, project, findings, partial) {
  if (partial) return LOG(`${project}: partial read, no finding card closed`);
  const listed = await callTool(boardConfig, 'list_open', { project, type: 'finding' });
  if (!listed.ok || !Array.isArray(listed.data) || listed.notice) return LOG(`${project}: open finding cards not read, none closed`);
  const current = new Set(findings.map((item) => findingKey(project, item)));
  const prefix = `${project}/${FINDING_KEY_PART}-`;
  for (const card of listed.data) {
    if (card.status === 'done' || !String(card.key).startsWith(prefix) || current.has(card.key)) continue;
    // mark_done takes no details, so the close is a report: status done and the marker line appended to the details.
    const closed = await send(env, boardConfig, options.session, { key: card.key, project, status: 'done', source: 'agent', details_md: withCloseMarker(card.details_md) });
    if (!closed.ok) LOG(`finding card ${card.key} not closed (${closed.error})`);
  }
}

async function reportProject(env, boardConfig, options, optimiserConfig, project, rows, week, notice) {
  const findings = detectAll(rows, optimiserConfig, project);
  const dryRun = !options.fileFindings;
  const report = await send(env, boardConfig, options.session, reportArgs({ project, week, findings, runCount: rows.length, dryRun, notice }));
  if (!report.ok) return LOG(`report for ${project} skipped (${report.error})`);
  if (dryRun) return LOG(`${project}: dry run, report written with ${findings.length} finding(s), none filed or closed`);
  for (const item of findings) await fileFinding(env, boardConfig, options, project, item);
  await closeGone(env, boardConfig, options, project, findings, notice !== '');
  LOG(`${project}: report written and ${findings.length} finding card(s) handled`);
}

export async function main(argv, env = process.env) {
  const options = readOptions(argv, env);
  const boardConfig = resolveConfig(env);
  if (!boardConfig) return;
  const optimiserConfig = readJson(options.configFile, 'config');
  if (!optimiserConfig) return;
  const loaded = await loadRuns(options, boardConfig, optimiserConfig);
  if (!loaded) return;
  const week = isoWeek(options.now);
  for (const [project, { rows, notice }] of loaded) {
    await reportProject(env, boardConfig, options, optimiserConfig, project, rows, week, notice);
  }
  if (loaded.size === 0) LOG('no runs in the window, nothing written');
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2))
    .catch((error) => LOG(`skipped (${error && error.name})`))
    .finally(() => {
      // Exit on the next turn, not inside the last request's callbacks: on Windows an exit while the fetch's handles are closing aborts the process (exit code 0xC0000409).
      setTimeout(() => process.exit(0), EXIT_DELAY_MS);
    });
}
