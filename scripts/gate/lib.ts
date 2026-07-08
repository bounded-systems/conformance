// Shared helpers for the conformance cross-repo drift gate.
//
// The gate reads another repo's source (guest-room) read-only and never mutates
// it. All file access is relative to a resolved guest-room root.

export interface GateConfig {
  guestRoom: {
    repo: string;
    rev?: string;
    localPath?: string;
    modEntry: string;
    trellis: string;
    readme: string;
  };
  deno?: { pinnedInCI?: string };
}

export interface Claim {
  claim: string;
  provenBy: string;
  via: string;
}

export interface PinRow {
  provenBy: string;
  pin: string;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  failures: string[];
  notes: string[];
}

/** Minimal `--key=value` / `--flag` parser. */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq === -1) out[a.slice(2)] = true;
    else out[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return out;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the guest-room checkout: `--guest-room=<path>` > config.localPath >
 * `../guest-room`. Picks the first candidate that actually contains the trellis
 * file, so a stale localPath doesn't silently win.
 */
export async function resolveGuestRoom(
  args: Record<string, string | boolean>,
  config: GateConfig,
): Promise<string> {
  const candidates = [
    typeof args["guest-room"] === "string"
      ? args["guest-room"] as string
      : null,
    config.guestRoom.localPath,
    "../guest-room",
  ].filter((c): c is string => Boolean(c)).map((c) => c.replace(/\/+$/, ""));

  for (const c of candidates) {
    if (await exists(`${c}/${config.guestRoom.trellis}`)) return c;
  }
  throw new Error(
    `could not locate a guest-room checkout containing ${config.guestRoom.trellis} ` +
      `(looked in: ${
        candidates.join(", ") || "<none>"
      }). Pass --guest-room=<path>.`,
  );
}

export async function readTrellisClaims(
  root: string,
  config: GateConfig,
): Promise<Claim[]> {
  const p = `${root}/${config.guestRoom.trellis}`;
  // deno-lint-ignore no-explicit-any
  const t: any = JSON.parse(await Deno.readTextFile(p));
  const claims = t?.descriptor?.proof?.claims;
  if (!Array.isArray(claims)) {
    throw new Error(`no descriptor.proof.claims[] in ${p}`);
  }
  return claims.map((c) => ({
    claim: c.claim,
    provenBy: c.provenBy,
    via: c.via,
  }));
}

/** First backticked token in a markdown table cell, or null. */
function firstBacktick(cell: string): string | null {
  const m = cell.match(/`([^`]+)`/);
  return m ? m[1] : null;
}

/**
 * Parse guest-room's generated README claims table (the
 * `<!-- descriptor:claims start/end -->` block). Each data row is
 * `| Claim | Proven by | Pinned at |`; we take the FIRST backticked token in
 * "Proven by" as the provenBy path and the backticked token in "Pinned at" as
 * the pin. A path may appear on more than one row (e.g. protocol.test.ts).
 */
export async function parseReadmeClaimsTable(
  root: string,
  config: GateConfig,
): Promise<PinRow[]> {
  const p = `${root}/${config.guestRoom.readme}`;
  const md = await Deno.readTextFile(p);
  const start = md.indexOf("<!-- descriptor:claims start -->");
  const end = md.indexOf("<!-- descriptor:claims end -->");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`no <!-- descriptor:claims start/end --> block in ${p}`);
  }
  const block = md.slice(start, end);
  const rows: PinRow[] = [];
  for (const line of block.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((s) => s.trim());
    // "| Claim | Proven by | Pinned at |" → ["", Claim, ProvenBy, Pinned, ""]
    if (cells.length < 5) continue;
    const provenCell = cells[2];
    const pinCell = cells[3];
    if (provenCell === "Proven by" || provenCell.startsWith("---")) continue; // header / separator
    const provenBy = firstBacktick(provenCell);
    const pin = firstBacktick(pinCell);
    if (provenBy && pin) rows.push({ provenBy, pin });
  }
  if (rows.length === 0) {
    throw new Error(`parsed no pin rows from the claims block in ${p}`);
  }
  return rows;
}
