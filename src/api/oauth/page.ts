import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

/** Every word on the authorize page. No private data: the owner's name and hosts never appear here. */
export const STRINGS = {
  title: "Connect to the board",
  intro: "wants to read your board and report to it.",
  canWrite: "It can add and change items, ask you questions and report usage, but it cannot sync plan documents.",
  sendsTo: "Access will be sent to",
  unverified: "This app registered itself; its name is not verified.",
  loopbackWarning: "This sends access to an app on your computer. Continue only if you just started signing in from it.",
  passphraseLabel: "Owner passphrase",
  allow: "Allow",
  deny: "Deny",
  wrongPassphrase: "That passphrase is not right.",
  notSetUp: "Sign-in is not set up on this board, so nobody can connect.",
  expired: "This sign-in page is not valid, expired or was already used. Start again from the app.",
  invalidRequest: "This sign-in request is not valid.",
} as const;

export enum PageProblem {
  None = "none",
  WrongPassphrase = "wrong",
}

export interface FormView {
  details: ConsentDescription;
  handle: string;
  problem: PageProblem;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** The consent form: one server-rendered page, no scripts, no third-party requests. */
export function renderForm(view: FormView): string {
  const { details, handle } = view;
  const body = [
    `<h1>${escapeHtml(STRINGS.title)}</h1>`,
    `<p><strong>${escapeHtml(details.clientName)}</strong> ${escapeHtml(STRINGS.intro)} ${escapeHtml(STRINGS.canWrite)}</p>`,
    `<p>${escapeHtml(STRINGS.sendsTo)} <strong>${escapeHtml(details.redirectUri)}</strong></p>`,
    `<p>${escapeHtml(STRINGS.unverified)}</p>`,
    details.redirectIsLoopback ? `<p><strong>${escapeHtml(STRINGS.loopbackWarning)}</strong></p>` : "",
    problemLine(view),
    formBody(handle),
  ];
  return document(body.join("\n"));
}

function problemLine(view: FormView): string {
  if (view.problem === PageProblem.WrongPassphrase) return `<p role="alert">${escapeHtml(STRINGS.wrongPassphrase)}</p>`;
  return "";
}

function formBody(handle: string): string {
  return `<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<p><label>${escapeHtml(STRINGS.passphraseLabel)} <input type="password" name="passphrase" autocomplete="current-password" autofocus></label></p>
<p><button name="decision" value="approve">${escapeHtml(STRINGS.allow)}</button> <button name="decision" value="deny" formnovalidate>${escapeHtml(STRINGS.deny)}</button></p>
</form>`;
}

/** A plain message page (not set up, expired, invalid request). */
export function renderMessage(text: string): string {
  return document(`<h1>${escapeHtml(STRINGS.title)}</h1>\n<p>${escapeHtml(text)}</p>`);
}

function document(body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(STRINGS.title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem}input{font:inherit}button{font:inherit;padding:.4rem 1rem}</style>
</head><body>
${body}
</body></html>`;
}
