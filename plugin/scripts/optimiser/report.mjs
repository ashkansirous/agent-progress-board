// The optimiser's text (Slice 57): the weekly report card, one finding card, and their keys. Pure, no network.
import { createHash } from 'node:crypto';

export const REPORT_KEY_PART = 'optimiser-report';
export const FINDING_KEY_PART = 'finding';
export const MAX_DETAILS = 19_000; // the board's text limit is 20,000 characters
// The line the script writes into a finding card's details when it closes the card itself (Decision 14); read back on the next run.
export const CLOSE_MARKER = 'Closed by the weekly optimiser run: it no longer found this.';
export const hasCloseMarker = (details) => typeof details === 'string' && details.split('\n').some((line) => line.trim() === CLOSE_MARKER);
export const withCloseMarker = (details) => `${String(details || '').split('\n').filter((line) => line.trim() !== CLOSE_MARKER).join('\n').trimEnd()}\n\n${CLOSE_MARKER}`;
const MAX_TITLE = 300;
const FINGERPRINT_LENGTH = 10;
const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;
const THURSDAY = 4;
const SECONDS_PER_MINUTE = 60;

// "2026-W48": the ISO week the date falls in (weeks start on Monday; the week belongs to the year of its Thursday).
export function isoWeek(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || DAYS_PER_WEEK;
  day.setUTCDate(day.getUTCDate() + THURSDAY - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / MS_PER_DAY + 1) / DAYS_PER_WEEK);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export const reportKey = (project, week) => `${project}/${REPORT_KEY_PART}-${week}`;

// A finding's key is stable across weeks: the same detector on the same process in the same project is the same card.
export function findingKey(project, item) {
  const digest = createHash('sha256').update(`${item.detector}\u0000${item.process}`).digest('hex').slice(0, FINGERPRINT_LENGTH);
  return `${project}/${FINDING_KEY_PART}-${item.detector}-${digest}`;
}

export function durationText(seconds) {
  if (seconds === null || seconds === undefined) return 'not known';
  if (seconds < SECONDS_PER_MINUTE) return `${seconds} s`;
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  return minutes < SECONDS_PER_MINUTE ? `${minutes} min` : `${Math.floor(minutes / SECONDS_PER_MINUTE)} h ${minutes % SECONDS_PER_MINUTE} min`;
}

const tokensText = (tokens) => (tokens === null || tokens === undefined ? 'not known' : tokens.toLocaleString('en-US'));

export function savingText(saving) {
  return `time ${durationText(saving.seconds)}, tokens ${tokensText(saving.tokens)}`;
}

function evidenceLine(row) {
  const parts = [`\`${row.item_key}\``, row.label];
  if (row.seconds !== null) parts.push(durationText(row.seconds));
  if (row.tokens !== null) parts.push(`${tokensText(row.tokens)} tokens`);
  return `- ${parts.join(' · ')}`;
}

export function clip(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

export const findingTitle = (item) => clip(item.title, MAX_TITLE);

// The card's details: the numbers, the evidence runs and the proposed change.
export function findingDetails(item) {
  const numbers = Object.entries(item.numbers).map(([name, value]) => `- ${name.replace(/_/g, ' ')}: ${Array.isArray(value) ? value.join(', ') : value ?? 'not known'}`);
  const hidden = item.runs - item.evidence.length;
  const lines = [
    `**Detector:** ${item.detector} · **Process:** ${item.process} · **Runs:** ${item.runs}`,
    `**Estimated saving:** ${savingText(item.saving)}`,
    '',
    '**Numbers**',
    ...numbers,
    '',
    '**Evidence runs**',
    ...item.evidence.map(evidenceLine),
    ...(hidden > 0 ? [`- and ${hidden} more`] : []),
    '',
    `**Proposed change:** ${item.proposal}`,
    '',
    'The board edits no repo: approve the change in your own repository.',
  ];
  return clip(lines.join('\n'), MAX_DETAILS);
}

// The weekly report: one line per finding, the dry-run note and a partial-read note when the board cut the rows.
export function reportDetails({ week, findings, runCount, dryRun, notice = '' }) {
  const lines = [
    `**Week:** ${week} · **Runs read:** ${runCount} · **Findings:** ${findings.length}`,
    dryRun ? '**Dry run:** no finding cards were filed; this report is the only output.' : '**Finding cards:** one is filed or updated per finding below, except one the owner already decided (done or archived) or one the board did not answer for.',
  ];
  if (notice) lines.push(`**Partial read:** ${notice}`);
  lines.push('');
  if (findings.length === 0) lines.push('No finding this week.');
  for (const item of findings) lines.push(`- **${item.title}** (${item.detector}) · saving ${savingText(item.saving)}`, `  - ${item.proposal}`);
  return clip(lines.join('\n'), MAX_DETAILS);
}

export const reportTitle = (week) => `Process report ${week}`;
export const reportOutcome = (findings, dryRun) => `${findings} finding${findings === 1 ? '' : 's'}${dryRun ? ' (dry run, none filed)' : ''}`;
