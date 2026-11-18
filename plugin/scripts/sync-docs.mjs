#!/usr/bin/env node
/* global process */
// Doc sync for the Agent Progress Board: read a repo's plan documents from origin/main and send
// the whole set to the board with one `sync_snapshot` call. Idempotent (same documents, same
// snapshot, nothing changes on the board), fails open (no token, no plan.md, a timeout or any
// board error is one stderr line and exit 0). Details: docs/setup/plan-sync.md.
//
// Usage: node sync-docs.mjs [--repo <dir>] [--ref origin/main] [--root <dir>] [--project <slug>]
//          [--parked <parked.md>] [--repo-url <https url>] [--dry-run]
// --root reads the documents from a folder instead of a git ref (tests, fixtures).
// --dry-run prints the snapshot items as JSON and sends nothing.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callTool, normaliseSliceNumber, parseArgs, projectSlug, resolveConfig, slugify } from './report-progress.mjs';

export const SYNC_TIMEOUT_MS = 5000;
export const MAX_ITEMS = 200;
const TITLE_LIMIT = 300;
const DETAILS_LIMIT = 20000; // the board's longest details_md
const WHY_LIMIT = 2000;
const SLICES_DIR = 'docs/plan/slices';
const DONE_PATH = 'docs/plan/notes/slices-done.md';
const SLICE_NUMBER = /^\d+[a-z]*$/i;
const PARKED_STATUS = /^\s*parked\b|waiting on the user/i;
// A park reason that waits only on work, never on the person: another slice (also in another repo), an
// interactive session, a deploy or a merge. Anchored at both ends, so any other word keeps the waiting card.
// "parked" may be followed by a colon, dash, em dash, comma or an opening parenthesis (PARK_SEPARATORS).
const PARK_SEPARATORS = String.raw`[\s:,(\-–—]*`;
const PARK_LEAD = new RegExp(String.raw`^\s*parked\b(${PARK_SEPARATORS})`, 'i');
const WAIT_LEAD = String.raw`^\s*(?:parked\b${PARK_SEPARATORS})?(?:wait(?:s|ing)\s+(?:for|on)|behind)\s+`;
export const WAIT_TARGETS = [
  String.raw`slice\s+\d+[a-z]*`,
  String.raw`(?:another|other)\s+repo(?:'s|’s)?\s+slice`,
  String.raw`(?:an?|the)\s+interactive\s+session`,
  String.raw`(?:an?|the)\s+(?:[\w-]+\s+)?deploy(?:ment)?`,
  String.raw`(?:an?|the)\s+merge`,
  String.raw`(?:the\s+)?CI`,
  String.raw`(?:PR|pull\s+request)\s*#?\d+`,
];
// An allow-list: the whole reason must be work targets and the closed set of words that may follow one (where it
// is, whether it is built, "to finish"), joined by "and", "then", a comma or a semicolon. Any other word (a person's
// name, "your answer", "pick the store") keeps the card.
export const TARGET_SUFFIX_WORDS = [
  String.raw`(?:of|in)\s+(?:the\s+)?(?:other\s+repo|slice\s+\d+[a-z]*)`,
  String.raw`of\s+(?:the\s+)?(?:build|deploy(?:ment)?|merge|release|CI|PR|pull\s+request)`,
  String.raw`to\s+(?:finish|merge|land|build|complete|deploy|pass|go\s+green|be\s+(?:built|merged|deployed|done))`,
  String.raw`to\s+(?:main|master|trunk)`,
  String.raw`(?:which\s+)?(?:is|are)\s+(?:not\s+)?(?:built|merged|done|deployed|finished)(?:\s+yet)?`,
  String.raw`finish(?:es)?`,
  String.raw`lands?`,
];
// A word may follow a comma ("Slice 29, which is not built yet").
const TARGET_SUFFIX = String.raw`(?:,?\s+(?:${TARGET_SUFFIX_WORDS.join('|')}))*`;
const WORK_ITEM = `(?:${WAIT_TARGETS.join('|')})\\b${TARGET_SUFFIX}`;
const WORK_JOIN = String.raw`(?:\s*[,;]\s*(?:and\s+)?(?:then\s+)?|\s+and\s+(?:then\s+)?|\s+then\s+)`;
const WAITS_ON_WORK = new RegExp(`${WAIT_LEAD}${WORK_ITEM}(?:${WORK_JOIN}${WORK_ITEM})*[\\s.)]*$`, 'i');
const TRAILING_ATTRIBUTION = /\s*\(\s*(?:user|owner)\s*,\s*\d{4}-\d{2}-\d{2}\s*\)\s*\.?\s*$/i;
// A park note is an italic or bold line near the top of the slice file: `*Parked: ...*`, `**Parked** - ...`,
// `_Waiting on the user._`. Prose, history lines and code fences never count.
const PARK_NOTE = /^\s*(?:\*{1,3}|_{1,3})\s*(?:parked|waiting on the user)\b[^\n]*/i;
const PARKED_LINE = /^\s*[-*]\s*slice\s+(\d+[a-z]*)\s*:\s*(.+?)\s*$/gim;
const UNVERIFIED_HEADING = /^###\s+slice\s+(\d+[a-z]*)\s*:/i;
const HASH_LENGTH = 8;
const MAX_PARTS = 26; // the board's limit: one capital letter A to Z each
export const MAX_CHECKS = 100; // the board's limit of checks under one slice (src/domain/checks.ts)
const WORK_HEADING = /^(#{2,4})\s+work(?:\s+items)?\s*$/i;
const ANY_HEADING = /^(#{1,6})\s/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const PART_HEADING = /^\s*(?:[-*+]\s+)?\*\*([A-Z])\.\s+(.+?)\*\*/;
const CHECKBOX = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/;
export const MAX_EXPANDED_ITEMS = 1000; // the board's limit on items plus parts (docs/clients.md, sync_snapshot)

function flatten(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

// The index at or below `end` that does not fall between the two halves of a surrogate pair.
function codePointBoundary(text, end) {
  const code = text.charCodeAt(end - 1);
  return end > 0 && code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
}

export function clip(text, limit) {
  const flat = flatten(text);
  return flat.length > limit ? `${flat.slice(0, codePointBoundary(flat, limit - 1))}…` : flat;
}

// The title of an item as its fields: the clipped title, and `details_md` with the rest of it when it was clipped,
// so the card still shows the whole text (the board stores it on a new key only).
export function titleFields(text) {
  const flat = flatten(text);
  const title = clip(flat, TITLE_LIMIT);
  const cut = codePointBoundary(flat, TITLE_LIMIT - 1);
  const rest = flat.length > TITLE_LIMIT ? flat.slice(cut).trim().slice(0, codePointBoundary(flat.slice(cut).trim(), DETAILS_LIMIT)) : '';
  return rest ? { title, details_md: rest } : { title };
}

// Markdown to plain text: links keep their label, emphasis and code marks go.
export function plain(text) {
  return String(text || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();
}

export function checkHash(line) {
  const normal = plain(line.replace(/^\s*[-*]\s+/, '')).toLowerCase().replace(/[.\s]+$/, '');
  return createHash('sha1').update(normal).digest('hex').slice(0, HASH_LENGTH);
}

// The reason after a "parked" lead (any PARK_SEPARATORS form); a "(" lead also loses its closing ")".
export function stripParkLead(text) {
  const match = PARK_LEAD.exec(text);
  if (!match) return text;
  const rest = text.slice(match[0].length);
  return match[1].includes('(') ? rest.replace(/\)\s*$/, '') : rest;
}

export function mapStatus(text) {
  const status = plain(text);
  if (PARKED_STATUS.test(status)) return { status: 'blocked', reason: stripParkLead(status) };
  if (/^in progress/i.test(status)) return { status: 'in_progress', reason: '' };
  if (/^(built|done|merged|verified|shipped)/i.test(status)) return { status: 'done', reason: '' };
  return { status: 'open', reason: '' };
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function columnMap(cells) {
  const names = cells.map((cell) => plain(cell).toLowerCase());
  const find = (pattern) => names.findIndex((name) => pattern.test(name));
  return { status: find(/^status$/), pr: find(/^pr$/), file: find(/^file$/) };
}

function linkTarget(cell) {
  const match = /\]\(([^)]+)\)/.exec(cell || '');
  return match ? match[1] : '';
}

const CONFLICT_MARKER = /^(?:<{7}|>{7})/m;

// The open slices in plan.md's `## Status` tables, with the `### <Product>` heading each sits under.
const isHeaderRow = (cells) => /^(#|slice)$/i.test(plain(cells[0])) && cells.some((cell) => /^status$/i.test(plain(cell)));

// One scan of plan.md: the rows, plus whether a recognised header was seen and any other table row
// (neither header nor separator) exists in a Status section.
function scanPlan(planText) {
  const rows = [];
  let inStatus = false;
  let product = '';
  let columns = null;
  let sawHeader = false;
  let sawOtherRow = false;
  for (const line of planText.split(/\r?\n/)) {
    if (/^##\s/.test(line)) { inStatus = /^##\s+status\b/i.test(line); product = ''; columns = null; continue; }
    if (!inStatus) continue;
    if (/^###\s/.test(line)) { product = plain(line.replace(/^###\s+/, '')); columns = null; continue; }
    if (!line.trim().startsWith('|')) continue;
    const cells = splitRow(line);
    if (isHeaderRow(cells)) { columns = columnMap(cells); sawHeader = true; continue; }
    if (!isSeparatorRow(line.trim())) sawOtherRow = true;
    if (!columns || !SLICE_NUMBER.test(plain(cells[0]))) continue;
    rows.push({
      number: normaliseSliceNumber(plain(cells[0])),
      title: plain(cells[1]),
      statusText: columns.status >= 0 ? cells[columns.status] || '' : '',
      pr: columns.pr >= 0 ? plain(cells[columns.pr]) : '',
      file: columns.file >= 0 ? linkTarget(cells[columns.file]) : '',
      product,
    });
  }
  return { rows, headerOnly: sawHeader && !sawOtherRow };
}

// A real separator row: 3+ dashes per cell, optional alignment colons. Blank or `| - |` rows are not one.
const isSeparatorRow = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line);

export function parsePlanTable(planText) {
  return scanPlan(planText).rows;
}

// The rows of docs/plan/notes/slices-done.md (one flat table, no `## Status` heading). Its file links are
// relative to that folder ("../slices/NN-x.md"), so each row's `file` is rewritten to a repo path.
export function parseDoneRows(doneText) {
  const rows = [];
  let columns = null;
  for (const line of String(doneText || '').split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = splitRow(line);
    if (isHeaderRow(cells)) { columns = columnMap(cells); continue; }
    if (!columns || !SLICE_NUMBER.test(plain(cells[0]))) continue;
    const file = columns.file >= 0 ? linkTarget(cells[columns.file]) : '';
    rows.push({
      number: normaliseSliceNumber(plain(cells[0])), title: plain(cells[1]), statusText: columns.status >= 0 ? cells[columns.status] || '' : '',
      pr: columns.pr >= 0 ? plain(cells[columns.pr]) : '', file: file ? `${SLICES_DIR}/${file.split('/').pop()}` : '', product: '',
    });
  }
  return rows;
}

// Built slices (a slices-done.md row that is not an open row) that still have a block in unverified.md. The
// board has no place for a check without its slice item (a closed slice's checks fall into the project's loose
// checks), so each becomes a slice item that carries its `checks`. Its status is `done`, like any "built" row
// (mapStatus): the code is merged, only the device checks are open, and groupBoard (boardGroups.ts) lists a done
// slice with open checks under Built, not In progress. A done-file row with no block stays out and the board closes it.
export function builtWithChecks(doneText, unverifiedText, openRows) {
  const open = new Set(openRows.map((row) => row.number));
  const withBlock = new Set(parseUnverified(unverifiedText || '').map((block) => block.number));
  return parseDoneRows(doneText).filter((row) => withBlock.has(row.number) && !open.has(row.number));
}

// True when `## Status` has a recognised header row and no data row at all (every slice built and moved out).
// A table with rows that carry no slice number is not empty: that is a mis-formatted table.
export function hasEmptyStatusTable(planText) {
  return scanPlan(planText).headerOnly;
}

function indentOf(line) {
  return /^\s*/.exec(line)[0].length;
}

// A bullet indented deeper than the check above it is part of that check, not a new one.
function addBullet(block, line) {
  const last = block.lines[block.lines.length - 1];
  if (last && indentOf(line) > indentOf(last.line)) last.nested.push(line.replace(/^\s*[-*]\s+/, ''));
  else block.lines.push({ line, nested: [] });
}

// `### Slice N: ...` blocks of docs/plan/unverified.md: each top-level bullet is one check
// ({ line, nested }); the hash covers the first line only.
export function parseUnverified(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = UNVERIFIED_HEADING.exec(line);
    if (heading) { current = { number: normaliseSliceNumber(heading[1]), lines: [] }; blocks.push(current); continue; }
    if (/^#{1,3}\s/.test(line)) { current = null; continue; }
    if (current && /^\s*[-*]\s+\S/.test(line)) addBullet(current, line);
  }
  return blocks;
}

export function parseParked(text) {
  const found = [];
  for (const match of text.matchAll(PARKED_LINE)) found.push({ number: normaliseSliceNumber(match[1]), reason: plain(match[2]) });
  return found;
}

// The park note of a slice file: the first PARK_NOTE line in its header, which is everything above the second
// heading (the title is the first), outside code fences.
export function parkNote(sliceText) {
  let headings = 0;
  let fence = null;
  for (const line of String(sliceText || '').split(/\r?\n/)) {
    const marker = FENCE_OPEN.exec(line);
    if (fence) {
      if (FENCE_CLOSE.test(line) && line.trim()[0] === fence) fence = null;
      continue;
    }
    if (marker) { fence = marker[1][0]; continue; }
    if (ANY_HEADING.test(line) && (headings += 1) > 1) break;
    const match = PARK_NOTE.exec(line);
    if (match) return plain(match[0]);
  }
  return '';
}

function githubUrl(remote) {
  const match = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(remote);
  return match ? `https://github.com/${match[1]}` : '';
}

function sliceLinks(row, repoUrl) {
  const links = [];
  if (repoUrl && row.file) links.push({ label: 'Slice file', url: `${repoUrl}/blob/main/${row.file.replace(/^\.?\//, '')}` });
  const pr = /(\d+)/.exec(row.pr);
  if (repoUrl && pr) links.push({ label: `PR #${pr[1]}`, url: `${repoUrl}/pull/${pr[1]}` });
  return links;
}

// True when a park reason starts with a wait on work (another slice, an interactive session, a deploy, a merge,
// CI; a trailing "(user, date)" attribution is ignored) and has nothing else but work: nothing is for the person to
// do, so the slice stays blocked with its reason and gets no waiting card. Any other word keeps the waiting card.
export function waitsOnlyOnWork(reason) {
  return WAITS_ON_WORK.test(withoutAttribution(reason));
}

function withoutAttribution(reason) {
  return String(reason || '').replace(TRAILING_ATTRIBUTION, '');
}

// The lines under a slice file's "Open for the owner" heading (bullets, or the plain lines when there are none),
// joined: what the person must decide or do. '' when the file has no such section.
// A line that is exactly a placeholder ("None", "n/a", "TBD", "None, the owner has nothing to do."), never a
// sentence that only starts with one of those words ("Nothing is wired until you approve the DNS change.").
const NO_OWNER_ASK = /^[\s([]*(?:none|nothing(?:\s+(?:to do|needed|required|open|for the owner(?:\s+to do)?))?|no\s+(?:action|decisions?|questions?)(?:\s+(?:needed|required))?|n\/a|tbd|[-–—]+|(?:[-*_]\s*){3,})(?:[\s,.;:-]+(?:the )?owner has nothing to do)?[\s.!)\]]*$/i;
const OWNER_HEADING = /^#{1,6}\s+open for the owner\b/i;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

// The section's list items, wherever they sit in it (a blank line between items does not end the list); when it has
// no list item, its first paragraph. Code fences and placeholder lines are skipped, and the section ends at the next
// heading. Plain lines right under an item belong to it.
export function openForOwner(sliceText) {
  const items = [];
  const paragraph = [];
  let inside = false;
  let fence = null;
  let blank = false;
  for (const line of String(sliceText || '').split(/\r?\n/)) {
    if (fence) {
      if (FENCE_CLOSE.test(line) && line.trim()[0] === fence) fence = null;
      continue;
    }
    if (FENCE_OPEN.test(line)) { fence = FENCE_OPEN.exec(line)[1][0]; continue; }
    if (OWNER_HEADING.test(line)) { inside = true; continue; }
    if (!inside) continue;
    if (ANY_HEADING.test(line)) break;
    if (!line.trim()) { blank = true; continue; }
    const text = plain(line.replace(LIST_ITEM, ''));
    const startsItem = LIST_ITEM.test(line);
    if (!NO_OWNER_ASK.test(text)) {
      if (startsItem || (!blank && items.length > 0 && !paragraph.length)) items.push(text);
      else if (!items.length && (!blank || !paragraph.length)) paragraph.push(text);
    }
    blank = false;
  }
  return (items.length ? items : paragraph).join(' ');
}

// A parked slice's card says what the person must decide or do (the slice file's "Open for the owner" lines, else
// the park reason, else the slice's title), for which slice (`why`), with a link to its file.
function waitingItem(project, row, reason, parent, repoUrl, sliceText) {
  const links = sliceLinks(row, repoUrl);
  const title = openForOwner(sliceText) || withoutAttribution(reason).trim() || `Waiting on you: ${row.title}`;
  return {
    key: `${project}/slice-${row.number}/waiting`, project, type: 'waiting_for_me', status: 'open',
    ...titleFields(title), parent, why: clip(`Slice ${row.number}: ${row.title}`, WHY_LIMIT), ...(links.length ? { links } : {}),
  };
}

// A built row is `done` (only device checks are left) unless its slice file still has an unfinished part (an
// unticked part checkbox): then the code is not all merged and it stays `in_progress` (Slice 42, Decisions).
function statusOfRow(row, sliceText) {
  const mapped = row.built ? { status: 'done', reason: '' } : mapStatus(row.statusText);
  const isBuilt = row.built || /^built/i.test(plain(row.statusText));
  if (!isBuilt || mapped.status !== 'done') return mapped;
  const unfinished = parseParts(sliceText).some((part) => !part.done);
  return unfinished ? { status: 'in_progress', reason: '' } : mapped;
}

// The table row alone decides whether a slice waits on the user; a park note in the slice file
// only supplies the reason while the row is parked.
function sliceItems(project, row, notes, repoUrl, sliceText = '') {
  const mapped = statusOfRow(row, sliceText);
  const parent = row.product ? `Plan · ${row.product}` : 'Plan';
  const links = sliceLinks(row, repoUrl);
  const item = {
    key: `${project}/slice-${row.number}`, project, type: 'slice', status: mapped.status,
    ...titleFields(row.title), parent, ...(mapped.reason ? { why: clip(mapped.reason, WHY_LIMIT) } : {}),
    ...(links.length ? { links } : {}), ...partsField(sliceText),
  };
  if (mapped.status !== 'blocked') return [item];
  const reason = mapped.reason || stripParkLead(notes.get(row.number) || '');
  if (waitsOnlyOnWork(reason)) return [item];
  return [item, waitingItem(project, row, reason, parent, repoUrl, sliceText)];
}

// The slice file's Work section as lines (outside code fences), or null when it has none. The
// heading is `##` to `####` with the text "Work" or "Work items"; the first one wins. The section
// ends at the next heading of the same or a higher level; a deeper heading stays inside it, and a
// `#` line in a fenced code block is not a heading.
function workLines(sliceText) {
  let fence = null; // the open fence's character and length
  let level = 0;
  const lines = [];
  for (const line of String(sliceText || '').split(/\r?\n/)) {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opened = FENCE_OPEN.exec(line);
    if (opened) { fence = { char: opened[1][0], length: opened[1].length }; continue; }
    const heading = ANY_HEADING.exec(line);
    if (!level) {
      const work = WORK_HEADING.exec(line);
      if (work) level = work[1].length;
      continue;
    }
    if (heading && heading[1].length <= level) break;
    lines.push(line);
  }
  if (!level) return null;
  lines.unclosedFence = Boolean(fence);
  return lines;
}

function closesFence(line, fence) {
  const match = FENCE_CLOSE.exec(line);
  return Boolean(match) && match[1][0] === fence.char && match[1].length >= fence.length;
}

function groupLines(lines) {
  const parts = [];
  let current = null;
  for (const line of lines) {
    const heading = PART_HEADING.exec(line);
    if (heading) {
      const seen = parts.some((part) => part.letter === heading[1]);
      current = seen ? null : { letter: heading[1], title: clip(plain(heading[2]), TITLE_LIMIT), ticked: 0, open: 0 };
      if (current) parts.push(current);
      continue;
    }
    const box = CHECKBOX.exec(line);
    if (box && current) current[/x/i.test(box[1]) ? 'ticked' : 'open'] += 1;
  }
  return parts.slice(0, MAX_PARTS).map((part) => ({ letter: part.letter, title: part.title, done: part.ticked > 0 && part.open === 0 }));
}

// Lettered groups of a slice's work list: a bold "**A. Title**" heading line, with or without a
// bullet. A group is done when it has checkboxes and every one is ticked; a repeated letter keeps
// the first group and its checkboxes only. Pure; [] for no letters.
export function parseParts(sliceText) {
  return groupLines(workLines(sliceText) || []);
}

// `parts: [...]` when the slice file was read and has a Work section (an empty list closes parts
// that no longer exist); left out when the file could not be read or has no Work section, so the
// board keeps what it has.
function partsField(sliceText) {
  const lines = workLines(sliceText);
  if (!lines) return {};
  const parts = groupLines(lines);
  // An unclosed fence hides the rest of the file: with no part found before it, say nothing.
  if (lines.unclosedFence && !parts.length) return {};
  return { parts };
}

// The checks of one slice as the board's snapshot shape (agent-progress-board Slice 14: `checks: [{key, title}]`
// on the slice item, never items of their own). The key stays `<slice key>/check-<hash>`, the form the board needs.
const OWNER_STEP = /^\*\*you:\*\*/i; // a line "**You:** ..." is the owner's own step, not a check of the slice

function isOwnerStep({ line }) {
  return OWNER_STEP.test(line.replace(/^\s*[-*]\s+/, ''));
}

function entryTitle({ line, nested }) {
  return clip(plain([line.replace(/^\s*[-*]\s+/, ''), ...nested].join(' ')), TITLE_LIMIT);
}

// An entry whose title is empty once markup is stripped would make the board refuse the whole snapshot
// (label min 1): it is skipped with a notice instead.
function withTitle(entries, where, notices) {
  return entries.filter((entry) => {
    if (entryTitle(entry)) return true;
    notices.push(`sync-docs: an empty entry in ${where} skipped\n`);
    return false;
  });
}

function checksOf(project, block, notices) {
  const checks = withTitle(block.lines.filter((entry) => !isOwnerStep(entry)), `unverified.md slice ${block.number}`, notices).map((entry) => ({
    key: `${project}/slice-${block.number}/check-${checkHash(entry.line)}`,
    title: entryTitle(entry),
  }));
  return dedupe(checks);
}

// The step without its `**You:**` prefix, and the "so that ..." the line gives for it ('' when it gives none).
const OWNER_PREFIX = /^\s*(?:[-*]\s+)?\*\*you:\*\*\s*/i;
// A "so that" clause runs to the end of its sentence: a period ends it only before a space and a capital or at the
// end ("v1.2", "e.g. the picker" stay inside), and it is read from the whole step, before the title is clipped.
const SO_THAT = /\b[Ss]o that\b.*?(?:[.!?](?=\s+[A-Z])|[.!?]?$)/;

function ownerStepFull(entry) {
  return plain([entry.line.replace(OWNER_PREFIX, ''), ...entry.nested].join(' '));
}

// The owner's steps of a block stay items of their own, as before checks moved into the slice item. Each says what
// the step is (title), for which slice and what it unblocks (why), and links to the slice file.
function ownerItems(project, blocks, notices, rows, repoUrl) {
  return dedupe(blocks.flatMap((block) => {
    const row = rows.find((candidate) => candidate.number === block.number);
    const steps = withTitle(block.lines.filter(isOwnerStep), `unverified.md slice ${block.number}`, notices);
    if (!row) {
      if (steps.length) notices.push(`sync-docs: slice ${block.number} has owner steps in unverified.md but no status row, not sent\n`);
      return [];
    }
    return steps.map((entry) => ownerItem(project, block, row, entry, repoUrl));
  }));
}

function ownerItem(project, block, row, entry, repoUrl) {
  const full = ownerStepFull(entry);
  const rowTitle = clip(row.title, TITLE_LIMIT);
  const sliceName = rowTitle ? `Slice ${block.number}: ${rowTitle}` : `Slice ${block.number}`;
  const unblocks = SO_THAT.exec(full);
  const links = sliceLinks(row, repoUrl);
  return {
    key: `${project}/slice-${block.number}/check-${checkHash(entry.line)}`, project,
    type: 'waiting_for_me', status: 'open',
    ...(clip(full, TITLE_LIMIT) ? titleFields(full) : { title: entryTitle(entry) }),
    why: clip(unblocks ? `${sliceName} — ${unblocks[0]}` : `Not yet verified for ${sliceName}`, WHY_LIMIT),
    parent: `Slice ${block.number} · Not yet verified`,
    ...(links.length ? { links } : {}),
  };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => (seen.has(item.key) ? false : seen.add(item.key)));
}

// Puts each `unverified.md` block inside its slice's item. A block for a slice that is not an open row has no
// card to hold it (its lines stay in unverified.md); a slice over the board's per-slice cap keeps its first
// MAX_CHECKS. Both are named in `notices`. A slice with no block gets `checks: []` (the board closes checks verified
// since); with no unverified.md text at all (null: not read) nothing is sent, so the board keeps its checks.
function attachChecks(project, slices, blocks, notices) {
  if (blocks === null) return slices;
  const bySlice = new Map(blocks.map((block) => [block.number, checksOf(project, block, notices)]));
  for (const [number, checks] of bySlice) {
    if (checks.length && !slices.some((item) => item.key === `${project}/slice-${number}`)) notices.push(`sync-docs: slice ${number} has checks in unverified.md but no open row, not sent\n`);
  }
  return slices.map((item) => {
    const checks = bySlice.get(item.key.slice(`${project}/slice-`.length)); // a waiting child's key ends `/waiting`: no block has that number
    if (!checks) return item.type === 'slice' ? { ...item, checks: [] } : item;
    if (checks.length > MAX_CHECKS) notices.push(`sync-docs: ${item.key} has ${checks.length} checks, only the first ${MAX_CHECKS} sent\n`);
    return { ...item, checks: checks.slice(0, MAX_CHECKS) };
  });
}

// Never a partial snapshot: sync_snapshot closes whatever is missing, so a cut item would read as
// done. Over the cap the whole list is withheld (`items` is empty, `withheld` holds the list for a dry run) and the
// caller reports the count.
// The board's 200 limit counts the items sent; items plus parts have their own limit of 1000
// (docs/clients.md, sync_snapshot). `limit` names the one that was hit.
export function capItems(all) {
  const expanded = all.reduce((sum, item) => sum + 1 + (item.parts ? item.parts.length : 0), 0); // checks have their own per-slice cap (MAX_CHECKS), they are not items or parts
  if (all.length > MAX_ITEMS) return { items: [], withheld: all, count: all.length, expanded, overflow: true, limit: MAX_ITEMS };
  if (expanded > MAX_EXPANDED_ITEMS) return { items: [], withheld: all, count: expanded, expanded, overflow: true, limit: MAX_EXPANDED_ITEMS };
  return { items: all, count: all.length, expanded, overflow: false, limit: 0 };
}

// Pure: documents in, snapshot out ({ items, cut, overflow }). The same documents give the same
// snapshot for every caller, because sync_snapshot closes whatever is missing from it.
export function buildSnapshot({ project, planText, unverifiedText = null, doneText = '', sliceTexts = {}, repoUrl = '' }) {
  const open = parsePlanTable(planText);
  const notices = [];
  const allRows = [...open, ...builtWithChecks(doneText, unverifiedText, open).map((row) => ({ ...row, built: true }))];
  const rows = allRows.filter((row) => {
    if (clip(row.title, TITLE_LIMIT)) return true;
    notices.push(`sync-docs: slice ${row.number} has an empty title, skipped\n`);
    return false;
  });
  const notes = new Map();
  for (const row of rows) {
    const note = parkNote(sliceTexts[row.number]);
    if (note) notes.set(row.number, note);
  }
  const slices = dedupe(rows.flatMap((row) => sliceItems(project, row, notes, repoUrl, sliceTexts[row.number])));
  const blocks = unverifiedText === null ? null : parseUnverified(unverifiedText);
  const withChecks = attachChecks(project, slices, blocks, notices);
  const owner = blocks === null ? [] : ownerItems(project, blocks, notices, rows, repoUrl);
  return { ...capItems([...withChecks, ...owner]), notices };
}

export function buildItems(documents) {
  return buildSnapshot(documents).items;
}

function folderSource(root) {
  return {
    read: (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null),
    list: (dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : []),
  };
}

// Each git call has its own timeout, and the whole read has a deadline: a slow repo costs at most GIT_DEADLINE_MS,
// not a timeout per file. When it passes, the next git call throws and the sync reads nothing more.
export const GIT_CALL_TIMEOUT_MS = 10000;
export const GIT_DEADLINE_MS = 30000;

export function gitSource(repo, ref, deadlineMs = GIT_DEADLINE_MS) {
  const deadline = Date.now() + deadlineMs;
  const git = (args) => {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error('git read deadline passed');
    return execFileSync('git', ['-C', repo, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: Math.min(GIT_CALL_TIMEOUT_MS, left), maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  };
  const tree = (path) => git(['ls-tree', '--name-only', ref, '--', path]).split(/\r?\n/).filter(Boolean);
  return {
    // null only when a successful listing shows no such entry; any failed git call throws.
    read: (path) => {
      try {
        if (!tree(path).length) return null;
        return git(['show', `${ref}:${path}`]);
      } catch (error) {
        throw new SourceError(path, error);
      }
    },
    list: (dir) => {
      try {
        return tree(`${dir}/`).map((entry) => entry.slice(dir.length + 1));
      } catch (error) {
        throw new SourceError(dir, error);
      }
    },
  };
}

export class SourceError extends Error {
  constructor(path, cause) {
    super(`could not read ${path}`, { cause });
    this.path = path;
  }
}

// The File cell's link as a repo path: no `#anchor`, URL escapes decoded; '' for an absolute path or one with `..`
// (never read outside the root), so the by-number file is used instead.
export function safeLinkPath(link) {
  let path = String(link || '').replace(/#.*$/, '').replace(/^\.\//, '');
  try { path = decodeURIComponent(path); } catch { return ''; }
  if (!path || /^(?:[\\/]|[a-z]:|[a-z][a-z0-9+.-]*:)/i.test(path)) return '';
  return path.split(/[\\/]+/).includes('..') ? '' : path;
}

const SLICE_FILE_NAME = /^(\d+[a-z]*)-.+\.md$/i;

// The slice files named for one number: the whole number before the first dash, nothing else ("3-1-x.md" is slice 3).
export function filesForSlice(names, number) {
  return names.filter((name) => {
    const match = SLICE_FILE_NAME.exec(name);
    return match && normaliseSliceNumber(match[1]) === number;
  });
}

// { texts, notices }. The File cell's link wins; else the one file whose name starts with the slice's number. Two
// such files are ambiguous: neither is read and a notice names them.
function readSliceTexts(source, rows) {
  const names = source.list(SLICES_DIR);
  const texts = {};
  const notices = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.number)) continue;
    seen.add(row.number);
    const byLink = safeLinkPath(row.file);
    const linked = byLink ? source.read(byLink) : null;
    if (linked) { texts[row.number] = linked; continue; }
    const named = filesForSlice(names, row.number);
    if (named.length > 1) { notices.push(`sync-docs: slice ${row.number} matches ${named.length} files (${named.join(', ')}), none read\n`); continue; }
    const text = named.length ? source.read(`${SLICES_DIR}/${named[0]}`) : null;
    if (text) texts[row.number] = text;
  }
  return { texts, notices };
}

function remoteUrl(repo) {
  try {
    return githubUrl(execFileSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, windowsHide: true }));
  } catch {
    return '';
  }
}

function readParked(path) {
  try {
    return path ? readFileSync(path, 'utf8') : '';
  } catch {
    return '';
  }
}

// The optional --parked file never adds an item (it would make the snapshot differ by caller). It only names
// the slices a runner parked whose row on main is not parked yet.
export function unparkedNotices(parkedText, rows) {
  const blocked = new Set(rows.filter((row) => mapStatus(row.statusText).status === 'blocked').map((row) => row.number));
  return parseParked(parkedText).filter((entry) => !blocked.has(entry.number))
    .map((entry) => `sync-docs: slice ${entry.number} is parked in parked.md but its row on main is not parked yet, not sent\n`);
}

// '' when unverified.md is absent (nothing is unverified: the board closes the checks). A failed read throws a
// SourceError and aborts the sync like every other source: a snapshot without it would close its cards.
export function readUnverified(source) {
  const path = 'docs/plan/unverified.md';
  try {
    const text = source.read(path);
    return text === null ? '' : text;
  } catch (error) {
    throw error instanceof SourceError ? error : new SourceError(path, error);
  }
}

// With --root the documents are not a git checkout: the name is the folder's own, never an enclosing repo's.
function rootSlug(root, env) {
  return env.AGENT_BOARD_PROJECT ? slugify(env.AGENT_BOARD_PROJECT) : slugify(basename(resolve(root)));
}

export function collect(parsed, env = process.env) {
  const repo = parsed.repo || process.cwd();
  const source = parsed.root ? folderSource(parsed.root) : gitSource(repo, parsed.ref || 'origin/main');
  const planText = source.read('plan.md');
  if (planText === null) return null;
  const project = parsed.project || (parsed.root ? rootSlug(parsed.root, env) : projectSlug(repo, env));
  if (CONFLICT_MARKER.test(planText)) {
    process.stderr.write('sync-docs: plan.md holds git conflict markers, nothing sent\n');
    return null;
  }
  const { rows, headerOnly } = scanPlan(planText);
  if (!rows.length && !headerOnly) return null;
  const unverifiedText = readUnverified(source);
  const doneText = source.read(DONE_PATH) || '';
  const built = builtWithChecks(doneText, unverifiedText, rows);
  const slices = readSliceTexts(source, [...rows, ...built]);
  const snapshot = buildSnapshot({
    project, planText, unverifiedText, doneText,
    sliceTexts: slices.texts,
    repoUrl: parsed['repo-url'] || (parsed.root ? '' : remoteUrl(repo)),
  });
  const notices = [...slices.notices, ...snapshot.notices, ...unparkedNotices(readParked(parsed.parked), rows)];
  if (!rows.length) notices.push('sync-docs: status table empty, closing all items of the project\n');
  return { project, ...snapshot, notices };
}

function reportCaps(snapshot) {
  for (const notice of snapshot.notices) process.stderr.write(notice);
  if (!snapshot.overflow) return;
  const what = snapshot.limit === MAX_ITEMS ? 'items' : 'items and parts';
  process.stderr.write(`sync-docs: ${snapshot.count} ${what} exceed the ${snapshot.limit}-${snapshot.limit === MAX_ITEMS ? 'item' : 'item-and-part'} cap, nothing sent\n`);
}

// The result line: each count the board gave, only when it is a number; a reply with none says so.
export function syncLine(snapshot, data) {
  const counts = data && typeof data === 'object' ? data : {};
  const given = ['created', 'updated', 'closed', 'unchanged'].filter((name) => Number.isFinite(counts[name])).map((name) => `${name}=${counts[name]}`);
  return `sync-docs: ${snapshot.project} items=${snapshot.items.length} ${given.length ? given.join(' ') : 'the board gave no counts'}`;
}

export async function main(argv, env = process.env) {
  const parsed = parseArgs(argv.filter((arg) => arg !== '--dry-run'));
  let snapshot;
  try {
    snapshot = collect(parsed, env);
  } catch (error) {
    if (!(error instanceof SourceError)) throw error;
    return process.stderr.write(`sync-docs: could not read ${error.path}, nothing sent\n`);
  }
  if (!snapshot) return process.stderr.write('sync-docs: no plan.md with a recognised status table, nothing sent\n');
  reportCaps(snapshot);
  if (argv.includes('--dry-run')) return process.stdout.write(`${JSON.stringify(snapshot.overflow ? snapshot.withheld : snapshot.items, null, 2)}\n`);
  if (snapshot.overflow) return;
  const config = resolveConfig(env);
  if (!config) return;
  const outcome = await callTool(config, 'sync_snapshot', { project: snapshot.project, items: snapshot.items }, { timeoutMs: SYNC_TIMEOUT_MS });
  if (!outcome.ok) return process.stderr.write(`sync-docs: sync_snapshot skipped (${outcome.error})\n`);
  process.stdout.write(`${syncLine(snapshot, outcome.data)}\n`);
  return { synced: true };
}

function isInvokedDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
const invokedDirectly = isInvokedDirectly();
if (invokedDirectly) {
  main(process.argv.slice(2))
    .catch((error) => process.stderr.write(`sync-docs: skipped (${error && error.name})\n`))
    .finally(() => { process.exitCode = 0; });
}
