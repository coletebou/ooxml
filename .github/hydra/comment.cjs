// Builds the hydra review comment from the seat artifacts and creates or updates it on the pull
// request, so every run of hydra-review.yml leaves exactly one comment. Run by actions/github-script
// in the workflow's summary job, from the base commit of the pull request.
//
// Inputs: SEATS_DIR, where actions/download-artifact put one hydra-<seat> directory per seat
// (seat.json, report.json, report.md, status.json, console.log), and the run's job list, which
// names every seat and links its log even when the seat uploaded nothing.
'use strict';

const fs = require('fs');
const path = require('path');

const MARKER = '<!-- hydra-review:summary -->';
const ORDER = ['gpt61sol', 'gpt6sol', 'astra6', 'opus55', 'fable51', 'sonnet55'];
// GitHub refuses comment bodies over 65536 characters. Long reports are cut to fit, step by step,
// and every cut says so; the artifacts keep the full text.
const LIMIT = 65000;
const CAPS = [Infinity, 6000, 3000, 1500, 800, 400, 200];
const JOB_NAME = /^([A-Za-z0-9_]+) \((.+)\)$/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readSeats(dir) {
  const seats = new Map();
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return seats;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('hydra-')) continue;
    const base = path.join(dir, entry.name);
    const seat = readJson(path.join(base, 'seat.json'));
    const name = (seat && seat.seat) || entry.name.slice('hydra-'.length);
    seats.set(name, {
      seat,
      report: readJson(path.join(base, 'report.json')),
      status: readJson(path.join(base, 'status.json')),
    });
  }
  return seats;
}

function plain(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(?=[A-Za-z0-9])/g, '@\u200b');
}

// Escapes one line of prose, leaving its code spans as they are: Markdown shows code literally and
// does not decode entities there, so escaping inside them would print `&lt;`.
function inline(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      const next = line.indexOf('`', i);
      const end = next < 0 ? line.length : next;
      out += plain(line.slice(i, end));
      i = end;
      continue;
    }
    let open = i;
    while (open < line.length && line[open] === '`') open += 1;
    const size = open - i;
    let close = -1;
    for (let k = open; k < line.length;) {
      if (line[k] !== '`') {
        k += 1;
        continue;
      }
      let end = k;
      while (end < line.length && line[end] === '`') end += 1;
      if (end - k === size) {
        close = k;
        break;
      }
      k = end;
    }
    if (close < 0) {
      out += line.slice(i, open);
      i = open;
    } else {
      out += line.slice(i, close + size);
      i = close + size;
    }
  }
  return out;
}

// Model-written text goes in as Markdown, but never as HTML and never as a mention. Fenced blocks
// stay verbatim, and a fence the text leaves open is closed so it cannot swallow the comment.
function text(value) {
  const out = [];
  let fence = null;
  for (const line of String(value ?? '').split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      out.push(line);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    } else if (marker) {
      fence = marker[1];
      out.push(line);
    } else {
      out.push(inline(line));
    }
  }
  if (fence) out.push(fence);
  return out.join('\n');
}

function cell(value) {
  return plain(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function longestRun(value, char) {
  let best = 0;
  let run = 0;
  for (const c of String(value)) {
    run = c === char ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function code(value) {
  const s = String(value ?? '');
  const ticks = '`'.repeat(longestRun(s, '`') + 1);
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${s}${pad}${ticks}`;
}

function block(value) {
  const s = String(value ?? '').replace(/\s+$/, '');
  const ticks = '`'.repeat(Math.max(3, longestRun(s, '`') + 1));
  return `${ticks}text\n${s}\n${ticks}`;
}

function clip(value, cap, seat) {
  const s = String(value ?? '');
  if (s.length <= cap) return s;
  return `${s.slice(0, cap).replace(/\s+\S*$/, '')} [cut to fit this comment; the full text is in the hydra-${seat} artifact]`;
}

function duration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`;
}

function routeLabel(check) {
  if (!check) return 'no run record';
  if (check === 'OK') return 'requested model';
  if (check === 'SAME-MODEL-ROUTE-FALLBACK') return 'same model, fallback route';
  if (check.startsWith('SUBSTITUTED:')) return `substituted by ${check.slice('SUBSTITUTED:'.length)}`;
  if (check === 'NO-REPORT') return 'no completed attempt';
  return 'no run record';
}

function statusLabel(data, job) {
  const seat = data && data.seat;
  if (seat && seat.status) {
    if (seat.status === 'reviewer_unavailable') {
      return `reviewer unavailable${seat.reason ? ` (${seat.reason})` : ''}${seat.timed_out ? ', timed out' : ''}`;
    }
    return seat.status;
  }
  if (seat) return seat.helper_exit_code === 124 ? 'timed out, no report' : 'no report';
  if (job && job.status !== 'completed') return `job ${job.status}`;
  if (job) return `job ${job.conclusion}, no artifact`;
  return 'no artifact';
}

// Some models repeat the priority at the start of the title; show it once. A tag that disagrees
// with the finding's priority stays visible.
function findingTitle(finding) {
  const title = String(finding.title || 'Untitled finding');
  const tag = /^\s*\[(P[0-3])\]\s*/.exec(title);
  return tag && tag[1] === finding.priority && title.length > tag[0].length ? title.slice(tag[0].length) : title;
}

function findingLines(report, cap, seat) {
  const findings = Array.isArray(report.findings) ? report.findings : [];
  if (!findings.length) return ['No findings at P2 or above.', ''];
  const lines = [];
  findings.forEach((finding, index) => {
    const where = finding.code_location || {};
    const location = where.file_path ? code(where.line ? `${where.file_path}:${where.line}` : where.file_path) : '';
    const facts = [location, finding.category, typeof finding.confidence === 'number' ? `confidence ${finding.confidence}` : '']
      .filter(Boolean)
      .join(', ');
    lines.push(`**${index + 1}. [${text(finding.priority || '?')}] ${text(findingTitle(finding))}**`);
    if (facts) lines.push(facts);
    lines.push('', text(clip(finding.body, cap, seat)), '');
  });
  return lines;
}

function rejectedNote(report) {
  const parts = [
    ['priority_filtered_findings', 'below P2'],
    ['scope_rejected_findings', 'outside the reviewed change'],
    ['attribution_rejected_findings', 'with an unverifiable attribution'],
  ]
    .filter(([key]) => Array.isArray(report[key]) && report[key].length)
    .map(([key, why]) => `${report[key].length} ${why}`);
  return parts.length ? `The helper set aside findings: ${parts.join(', ')}.` : '';
}

// The model that wrote the report: what Claude reported, or for Codex what the command line set
// (marked *), or failing both the model the completed attempt asked for.
function modelThatRan(seat) {
  if (seat.model_actual) return `${code(seat.model_actual)}${seat.model_actual_source === 'engine_reported' ? '' : ' *'}`;
  if (seat.attempt_model) return `${code(seat.attempt_model)} (not reported)`;
  return '';
}

function seatSection(name, data, job, cap) {
  const seat = (data && data.seat) || {};
  const report = data && data.report;
  const requested = seat.requested_model || (job && job.model) || '';
  const status = statusLabel(data, job);
  let outcome = status;
  if (seat.report_produced && typeof seat.finding_count === 'number') {
    const count = `${seat.finding_count} finding${seat.finding_count === 1 ? '' : 's'}`;
    outcome = seat.status === 'findings' ? count : `${status}, ${count}`;
  }
  const lines = [
    '<details>',
    `<summary><b>${plain(name)}</b> (${plain(requested)}): ${plain(outcome)}</summary>`,
    '',
  ];
  const attempts = Array.isArray(seat.attempts) ? seat.attempts : [];
  if (attempts.length) {
    const trail = attempts.map((a) => `${code(a.model_actual || a.model || '?')} (${text(a.reason)}, ${text(a.status)}${a.refusal ? ', refused' : ''})`);
    lines.push(`Attempts: ${trail.join('; ')}.`, '');
  }
  if (seat.report_produced && report) {
    const confidence = typeof report.overall_confidence === 'number' ? `, confidence ${report.overall_confidence}` : '';
    lines.push(`**Verdict:** ${text(report.overall_correctness || 'none')}${confidence}. Status ${code(seat.status || '?')}.`, '');
    lines.push(...findingLines(report, cap, name));
    const note = rejectedNote(report);
    if (note) lines.push(note, '');
    if (report.overall_explanation) {
      lines.push('**Explanation**', '', text(clip(report.overall_explanation, cap, name)), '');
    }
  } else if (data && data.seat) {
    const exit = seat.helper_exit_code === null || seat.helper_exit_code === undefined ? 'none' : seat.helper_exit_code;
    lines.push(`No report. Helper exit code ${code(exit)}. The end of the helper's output:`, '');
    lines.push(block(clip(seat.console_tail || '(no output)', Math.max(cap, 800), name)), '');
  } else {
    lines.push('This seat uploaded nothing: its job ended before the review started. See the job log.', '');
  }
  if (job && job.url) lines.push(`[Job log](${job.url})`, '');
  lines.push('</details>');
  return lines.join('\n');
}

function buildBody({ seats, jobs, headSha, runUrl, runAttempt, updatedAt }) {
  const names = [...new Set([...ORDER, ...jobs.keys(), ...seats.keys()])].filter((n) => seats.has(n) || jobs.has(n));
  const any = [...seats.values()].map((d) => d.seat).find((s) => s && s.merge_base);
  const scope = any ? `${code(any.merge_base.slice(0, 12))}..${code(String(headSha).slice(0, 12))}` : code(String(headSha).slice(0, 12));
  const header = [
    MARKER,
    '## Hydra review',
    '',
    `${names.length} seats, each one run of the autoreview helper on its own model, over ${scope} (branch mode from the merge base, findings at P2 and above). [Workflow run](${runUrl}), attempt ${runAttempt}${updatedAt ? `, updated ${updatedAt}` : ''}.`,
    '',
    '| Seat | Requested model | Model that ran | Route check | Status | Findings | Time |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const name of names) {
    const data = seats.get(name);
    const seat = (data && data.seat) || {};
    const job = jobs.get(name);
    const label = job && job.url ? `[${cell(name)}](${job.url})` : cell(name);
    const ran = modelThatRan(seat);
    const count = seat.report_produced && typeof seat.finding_count === 'number' ? String(seat.finding_count) : '';
    header.push(`| ${label} | ${code(seat.requested_model || (job && job.model) || '?')} | ${ran} | ${cell(data && data.seat ? routeLabel(seat.route_check) : '')} | ${cell(statusLabel(data, job))} | ${count} | ${duration(seat.duration_seconds)} |`);
  }
  header.push(
    '',
    '\\* Codex does not report the model it ran, so a Codex seat shows the model the helper passed on the command line; after a route fallback that is the fallback model. Claude seats show the model the engine reported.',
    '',
  );
  const footer = [
    '',
    'Each seat uploads its full report, status and run record as the `hydra-<seat>` artifact of the run. Findings are advice to verify against the code. A failed seat can be retried once with "Re-run failed jobs".',
  ];
  for (const cap of CAPS) {
    const sections = names.map((name) => seatSection(name, seats.get(name), jobs.get(name), cap));
    const body = [...header, sections.join('\n\n'), ...footer].join('\n');
    if (body.length <= LIMIT) return body;
  }
  const sections = names.map((name) => seatSection(name, { seat: (seats.get(name) || {}).seat }, jobs.get(name), 0));
  return [...header, sections.join('\n\n'), ...footer].join('\n').slice(0, LIMIT);
}

async function listSeatJobs(github, context) {
  const jobs = new Map();
  const all = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    run_id: context.runId,
    filter: 'latest',
    per_page: 100,
  });
  for (const job of all) {
    const match = JOB_NAME.exec(job.name || '');
    if (match) jobs.set(match[1], { model: match[2], status: job.status, conclusion: job.conclusion, url: job.html_url });
  }
  return jobs;
}

async function upsert(github, context, body) {
  const { owner, repo } = context.repo;
  const issue_number = context.payload.pull_request.number;
  const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number, per_page: 100 });
  const existing = comments.find((c) => c.user && c.user.login === 'github-actions[bot]' && (c.body || '').includes(MARKER));
  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    return existing.html_url;
  }
  const created = await github.rest.issues.createComment({ owner, repo, issue_number, body });
  return created.data.html_url;
}

module.exports = async ({ github, context, core }) => {
  const seats = readSeats(process.env.SEATS_DIR);
  let jobs = new Map();
  try {
    jobs = await listSeatJobs(github, context);
  } catch (error) {
    core.warning(`Could not list the seat jobs: ${error.message}`);
  }
  const { serverUrl, runId } = context;
  const body = buildBody({
    seats,
    jobs,
    headSha: context.payload.pull_request.head.sha,
    runUrl: `${serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${runId}`,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1',
    updatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  });
  const url = await upsert(github, context, body);
  core.info(`Hydra review comment: ${url} (${body.length} characters, ${seats.size} seat artifacts)`);
};

module.exports.buildBody = buildBody;
module.exports.readSeats = readSeats;
module.exports.text = text;
module.exports.findingTitle = findingTitle;
