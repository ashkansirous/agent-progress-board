// The process optimiser's detectors (Slice 57): pure functions over `query_runs` rows and one config object, no network.
// A row is a finished step as the board's `query_runs` returns it: item_key, project, step_id, label, process, started_at,
// done_at, duration_seconds (null when no time of it was observed or reported), counts, cost (null when none).
// Rows carry no parent or sibling link: "siblings" are the rows of one item_key with the same process. A row's start and
// end are used only when both are set (a stamped-only row is skipped, never guessed). Every threshold, budget, process
// name and model name comes from the config; a detector whose config section is missing returns no findings.
// Config shape: see plugin/scripts/fixtures/optimiser/config.json and the skill's SKILL.md.

export const DETECTORS = {
  fanOut: 'fan-out',
  approval: 'approval',
  serial: 'serial',
  overBudget: 'over-budget',
  duplicate: 'duplicate',
  lowYield: 'low-yield',
  contextBloat: 'context-bloat',
  bigModel: 'big-model',
};

export const EVIDENCE_MAX = 8; // evidence rows kept per finding
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const TOKENS_PER_UNIT = 100_000; // the yield figure is per 100,000 tokens
const DEFAULT_FINDINGS_COUNT = 'findings'; // the counts names the reviewing steps send, unless the config names others
const DEFAULT_FIXES_COUNT = 'fixed';
const DEFAULT_MIN_PASS = 2;
const DEFAULT_MIN_REPEATS = 2;

// ---- reading a row -------------------------------------------------------------------------------------------

// { start, end } in ms when both times are set and in order, else null.
function boundsOf(row) {
  const start = Date.parse(row.started_at ?? '');
  const end = Date.parse(row.done_at ?? '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? { start, end } : null;
}

const timed = (row) => boundsOf(row) !== null;
const secondsOf = (row) => (Number.isFinite(row.duration_seconds) ? row.duration_seconds : null);
const tokensOf = (row) => (row.cost && Number.isFinite(row.cost.total_tokens) ? row.cost.total_tokens : null);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const known = (values) => values.filter((value) => value !== null);
const sumOrNull = (values) => (values.length > 0 ? sum(values) : null);

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalLabel = (label) => String(label ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

function evidenceOf(row) {
  return { item_key: row.item_key, step_id: row.step_id, label: row.label, process: row.process, started_at: row.started_at, done_at: row.done_at, seconds: secondsOf(row), tokens: tokensOf(row) };
}

function finding(detector, project, process, title, rows, numbers, saving, proposal) {
  return { detector, project, process, title, evidence: rows.slice(0, EVIDENCE_MAX).map(evidenceOf), runs: rows.length, numbers, saving, proposal };
}

const saving = (seconds, tokens) => ({ seconds, tokens });
const roundOrNull = (value) => (value === null ? null : Math.round(value));

// ---- 1. repeated fan-out ---------------------------------------------------------------------------------------

// The rows of one item's labels that ran more than once, and how many such labels (siblings) there are.
function redoneSiblings(itemRows) {
  const labels = [...groupBy(itemRows, (row) => normalLabel(row.label)).values()].filter((group) => group.length >= 2);
  return { siblings: labels.length, rows: labels.flat() };
}

/** The same step redone across N siblings of one item (rows of one item_key with one process and different labels). */
export function detectFanOut(rows, config, project = '') {
  const settings = config.fanOut;
  if (!isObject(settings) || !(settings.minSiblings >= 2)) return [];
  const found = [];
  const byProcess = groupBy(rows.filter(timed), (row) => row.process);
  for (const [process, processRows] of byProcess) {
    // Per item only the rows of a label that ran at least twice count: one-off siblings are ordinary work, not redone (Review 5).
    const worst = [...groupBy(processRows, (row) => row.item_key).values()]
      .map(redoneSiblings)
      .filter((group) => group.siblings >= settings.minSiblings)
      .sort((a, b) => b.rows.length - a.rows.length);
    if (worst.length === 0) continue;
    const all = worst.flatMap((group) => group.rows);
    const seconds = known(all.map(secondsOf));
    const typical = median(seconds);
    const redone = sum(worst.map((group) => group.rows.length - group.siblings));
    found.push(
      finding(DETECTORS.fanOut, project, process, `${process}: the same step redone across ${worst[0].siblings} siblings`, all, {
        items: worst.length, largest_group: worst[0].siblings, redone_runs: redone, total_seconds: roundOrNull(sumOrNull(seconds)), median_seconds: roundOrNull(typical),
      }, saving(typical === null ? null : Math.round(redone * typical), null),
      'Redo only the siblings a change touches; keep the others from the last run instead of rebuilding every one after each change.'),
    );
  }
  return found;
}

// ---- 2. work done before an approval step finished ---------------------------------------------------------

/** A gated step started before its approval step was done. Config: { approval: { "<approval key>": ["<gated key>", ...] } }. */
export function detectBeforeApproval(rows, config, project = '') {
  if (!isObject(config.approval)) return [];
  const found = [];
  const byItem = groupBy(rows.filter(timed), (row) => row.item_key);
  for (const [approvalKey, gatedKeys] of Object.entries(config.approval)) {
    for (const gatedKey of Array.isArray(gatedKeys) ? gatedKeys : []) {
      const early = [];
      for (const itemRows of byItem.values()) {
        const approvals = itemRows.filter((row) => row.process === approvalKey);
        if (approvals.length === 0) continue;
        // The first approval run of the key in this item: a later re-approval does not make earlier gated work "early" (Review 3).
        const approvedAt = boundsOf([...approvals].sort((a, b) => boundsOf(a).start - boundsOf(b).start)[0]).end;
        early.push(...itemRows.filter((row) => row.process === gatedKey && boundsOf(row).start < approvedAt));
      }
      if (early.length === 0) continue;
      const tokens = sumOrNull(known(early.map(tokensOf)));
      found.push(
        // The process names both steps: two approvals gating one process are two cards (Review 4).
        finding(DETECTORS.approval, project, `${approvalKey} -> ${gatedKey}`,`${gatedKey}: started before ${approvalKey} was done`, early, {
          approval: approvalKey, runs_before_approval: early.length, seconds_at_risk: roundOrNull(sumOrNull(known(early.map(secondsOf)))), tokens_at_risk: tokens,
        }, saving(null, tokens),
        `Start ${gatedKey} only after ${approvalKey} is done; work done before the approval is lost when the owner changes the text.`),
      );
    }
  }
  return found;
}

// ---- 3. independent steps run in series ----------------------------------------------------------------------

// The runs of two or more steps of one item, each of a different process from the one before it, that followed each other
// within maxGap. A step of the same process as the one before it (a re-run) ends the chain; a chain counts once however long (Review 2).
function serialChains(itemRows, maxGap) {
  const ordered = [...itemRows].sort((a, b) => boundsOf(a).start - boundsOf(b).start);
  const chains = [];
  let chain = [];
  for (const row of ordered) {
    const last = chain[chain.length - 1];
    const follows = last && row.process !== last.process && boundsOf(row).start >= boundsOf(last).end && boundsOf(row).start - boundsOf(last).end <= maxGap;
    if (follows) {
      chain.push(row);
      continue;
    }
    if (chain.length >= 2) chains.push(chain);
    chain = [row];
  }
  if (chain.length >= 2) chains.push(chain);
  return chains;
}

/** Rows of one group of independent process keys that ran one after the other. Config: { serial: { independent: [[key, key], ...], maxGapSeconds? } }. */
export function detectSerial(rows, config, project = '') {
  const settings = config.serial;
  if (!isObject(settings) || !Array.isArray(settings.independent)) return [];
  const maxGap = Number.isFinite(settings.maxGapSeconds) ? settings.maxGapSeconds * MS_PER_SECOND : Infinity;
  const found = [];
  for (const keys of settings.independent.filter((group) => Array.isArray(group) && group.length >= 2)) {
    const inGroup = rows.filter((row) => timed(row) && keys.includes(row.process));
    const chains = [];
    for (const itemRows of groupBy(inGroup, (row) => row.item_key).values()) {
      chains.push(...serialChains(itemRows, maxGap));
    }
    if (chains.length === 0) continue;
    // Run together, a chain takes as long as its longest step: the saving is the rest of its steps.
    const saved = sum(chains.map((chain) => {
      const lengths = chain.map((row) => boundsOf(row).end - boundsOf(row).start);
      return (sum(lengths) - Math.max(...lengths)) / MS_PER_SECOND;
    }));
    found.push(
      finding(DETECTORS.serial, project, keys.join(' + '), `${keys.join(' + ')}: independent steps ran one after the other`, chains.flat(), {
        serial_chains: chains.length,
      }, saving(Math.round(saved), null),
      `Run ${keys.join(' and ')} at the same time (separate helpers); neither needs the other's result.`),
    );
  }
  return found;
}

// ---- 4. a process over its time budget -------------------------------------------------------------------------

/** Runs longer than the process's `minutes` in `config.budgets.processes` (the shape of the board's budgets). */
export function detectOverBudget(rows, config, project = '') {
  const budgets = isObject(config.budgets) && isObject(config.budgets.processes) ? config.budgets.processes : {};
  const found = [];
  for (const [process, processRows] of groupBy(rows, (row) => row.process)) {
    const minutes = budgets[process] && budgets[process].minutes;
    if (!(minutes > 0)) continue;
    const limit = minutes * SECONDS_PER_MINUTE;
    const withTime = processRows.filter((row) => secondsOf(row) !== null);
    const over = withTime.filter((row) => secondsOf(row) > limit).sort((a, b) => secondsOf(b) - secondsOf(a));
    if (over.length === 0) continue;
    found.push(
      finding(DETECTORS.overBudget, project, process, `${process}: ${over.length} of ${withTime.length} runs over the ${minutes}-minute budget`, over, {
        budget_seconds: limit, timed_runs: withTime.length, runs_over: over.length, longest_seconds: secondsOf(over[0]), median_seconds: roundOrNull(median(withTime.map(secondsOf))),
      }, saving(Math.round(sum(over.map((row) => secondsOf(row) - limit))), null),
      `Cut ${process} to its budget: run only the part a change affects, split it into parts that run at the same time, or raise the budget on purpose.`),
    );
  }
  return found;
}

// ---- 5. duplicate work inside a run ----------------------------------------------------------------------------

/** The same step (process and label) done more than once in one item. Config: { duplicate: { minRepeats? } }. */
export function detectDuplicates(rows, config, project = '') {
  const settings = config.duplicate;
  if (!isObject(settings)) return [];
  const minRepeats = settings.minRepeats >= 2 ? settings.minRepeats : DEFAULT_MIN_REPEATS;
  const found = [];
  for (const [process, processRows] of groupBy(rows, (row) => row.process)) {
    const groups = [...groupBy(processRows, (row) => `${row.item_key}\u0000${normalLabel(row.label)}`).values()].filter((group) => group.length >= minRepeats);
    if (groups.length === 0) continue;
    const repeats = groups.flatMap((group) => [...group].sort((a, b) => String(a.done_at).localeCompare(String(b.done_at))).slice(1));
    const seconds = sumOrNull(known(repeats.map(secondsOf)));
    const tokens = sumOrNull(known(repeats.map(tokensOf)));
    found.push(
      finding(DETECTORS.duplicate, project, process, `${process}: the same step done again ${repeats.length} time${repeats.length === 1 ? '' : 's'}`, groups.flat(), {
        steps_repeated: groups.length, extra_runs: repeats.length, extra_seconds: roundOrNull(seconds), extra_tokens: tokens,
      }, saving(roundOrNull(seconds), tokens),
      `Do ${process} once per run and reuse its result; a repeat should need a changed input.`),
    );
  }
  return found;
}

// ---- 6. low-yield reviews ------------------------------------------------------------------------------------

/** A later pass of a review process whose findings plus fixes per 100,000 tokens fall under the threshold. */
export function detectLowYield(rows, config, project = '') {
  const settings = config.reviews;
  if (!isObject(settings) || !Array.isArray(settings.processes) || !(settings.maxYieldPer100kTokens > 0)) return [];
  const findingsName = settings.findingsCount || DEFAULT_FINDINGS_COUNT;
  const fixesName = settings.fixesCount || DEFAULT_FIXES_COUNT;
  const firstLate = (settings.minPass >= 2 ? settings.minPass : DEFAULT_MIN_PASS) - 1; // index of the first pass that is judged
  const found = [];
  for (const process of settings.processes) {
    const weak = [];
    const reviews = rows.filter((row) => row.process === process && row.done_at);
    for (const itemRows of groupBy(reviews, (row) => row.item_key).values()) {
      const ordered = [...itemRows].sort((a, b) => String(a.done_at).localeCompare(String(b.done_at)));
      for (let index = firstLate; index < ordered.length; index += 1) {
        const passYield = yieldOf(ordered[index], findingsName, fixesName);
        if (passYield !== null && passYield < settings.maxYieldPer100kTokens) weak.push(ordered[index]);
      }
    }
    if (weak.length === 0) continue;
    const tokens = sum(weak.map(tokensOf));
    found.push(
      finding(DETECTORS.lowYield, project, process, `${process}: ${weak.length} later pass${weak.length === 1 ? '' : 'es'} found and fixed little for their tokens`, weak, {
        passes: weak.length, tokens, max_yield_per_100k_tokens: settings.maxYieldPer100kTokens,
        worst_yield_per_100k_tokens: Math.min(...weak.map((row) => yieldOf(row, findingsName, fixesName))),
      }, saving(roundOrNull(sumOrNull(known(weak.map(secondsOf)))), tokens),
      `Skip the later ${process} pass when the first one found little, or run it only on what the first pass's fixes changed.`),
    );
  }
  return found;
}

// (findings + fixes) per 100,000 tokens, or null when the row has no cost or no count (an unknown figure is never zero).
function yieldOf(row, findingsName, fixesName) {
  const tokens = tokensOf(row);
  const counts = row.counts;
  if (!tokens || !isObject(counts) || !Number.isFinite(counts[findingsName])) return null;
  const fixes = Number.isFinite(counts[fixesName]) ? counts[fixesName] : 0;
  return ((counts[findingsName] + fixes) / tokens) * TOKENS_PER_UNIT;
}

// ---- 7. context bloat with no compact --------------------------------------------------------------------------

/** A finished step whose largest request passed the limit with no compaction. Config: { contextBloat: { peakContext } }, per process from budgets.processes[..].peakContext. */
export function detectContextBloat(rows, config, project = '') {
  const settings = config.contextBloat;
  if (!isObject(settings) || !(settings.peakContext > 0)) return [];
  const own = isObject(config.budgets) && isObject(config.budgets.processes) ? config.budgets.processes : {};
  const found = [];
  for (const [process, processRows] of groupBy(rows, (row) => row.process)) {
    const limit = own[process] && own[process].peakContext > 0 ? own[process].peakContext : settings.peakContext;
    const bloated = processRows.filter((row) => row.cost && row.cost.peak_context > limit && row.cost.compactions === 0).sort((a, b) => b.cost.peak_context - a.cost.peak_context);
    if (bloated.length === 0) continue;
    found.push(
      finding(DETECTORS.contextBloat, project, process, `${process}: ${bloated.length} run${bloated.length === 1 ? '' : 's'} grew past ${limit} tokens of context with no compact`, bloated, {
        limit, runs: bloated.length, largest_peak_context: bloated[0].cost.peak_context,
      }, saving(null, null),
      `Compact or split ${process} before its context passes ${limit} tokens; a long context is paid for again on every request.`),
    );
  }
  return found;
}

// ---- 8. a big model on a mechanical step ----------------------------------------------------------------------

/** A mechanical process that used a big model. Config: { bigModel: { mechanical: [process key], models: [model name part] } }. */
export function detectBigModel(rows, config, project = '') {
  const settings = config.bigModel;
  if (!isObject(settings) || !Array.isArray(settings.mechanical) || !Array.isArray(settings.models)) return [];
  const big = settings.models.map((name) => String(name).toLowerCase());
  const isBig = (entry) => big.some((name) => String(entry.model).toLowerCase().includes(name));
  const found = [];
  for (const [process, processRows] of groupBy(rows, (row) => row.process)) {
    if (!settings.mechanical.includes(process)) continue;
    const used = processRows.filter((row) => row.cost && Array.isArray(row.cost.models) && row.cost.models.some(isBig));
    if (used.length === 0) continue;
    const tokens = sum(used.map((row) => sum(row.cost.models.filter(isBig).map((entry) => sum([entry.input_tokens, entry.cache_read_tokens, entry.cache_write_tokens, entry.output_tokens].map((n) => n || 0))))));
    const names = [...new Set(used.flatMap((row) => row.cost.models.filter(isBig).map((entry) => entry.model)))].sort();
    found.push(
      finding(DETECTORS.bigModel, project, process, `${process}: ${used.length} run${used.length === 1 ? '' : 's'} on a big model (${names.join(', ')})`, used, {
        runs: used.length, tokens_on_big_model: tokens, models: names,
      }, saving(null, null),
      `Run ${process} on a small model: it is mechanical and needs no judgment.`),
    );
  }
  return found;
}

// ---- all of them ---------------------------------------------------------------------------------------------

const ALL = [detectFanOut, detectBeforeApproval, detectSerial, detectOverBudget, detectDuplicates, detectLowYield, detectContextBloat, detectBigModel];

/** Every detector over the rows of one project; the largest saving in seconds first, then tokens. */
export function detectAll(rows, config, project = '') {
  const settings = isObject(config) ? config : {};
  const worth = (item) => (item.saving.seconds ?? 0) + (item.saving.tokens ?? 0) / TOKENS_PER_UNIT;
  return ALL.flatMap((detect) => detect(rows, settings, project)).sort((a, b) => worth(b) - worth(a) || a.title.localeCompare(b.title));
}
