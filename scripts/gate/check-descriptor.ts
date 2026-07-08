// Check 1 — descriptor / proof honesty.
//
// For each descriptor.proof.claims[] in guest-room's trellis.json, assert:
//   (a) the provenBy file exists, and
//   (b) its git blob hash (first N hex, N = the README's truncation length)
//       matches the "Pinned at" digest recorded in guest-room's generated
//       README claims table.
// Also flags README rows that cite a provenBy with no matching trellis claim.
//
// This is the EXTERNAL, org-level twin of the descriptor-kit `check` that
// guest-room runs on itself (its own descriptor.yml workflow). conformance
// re-verifies the property from outside — the product repo is never wired to
// this gate.
import { gitBlobHash } from "./blob-hash.ts";
import {
  type CheckResult,
  exists,
  type GateConfig,
  parseReadmeClaimsTable,
  readTrellisClaims,
} from "./lib.ts";

export async function checkDescriptor(
  root: string,
  config: GateConfig,
): Promise<CheckResult> {
  const failures: string[] = [];
  const claims = await readTrellisClaims(root, config);
  const pins = await parseReadmeClaimsTable(root, config);

  const pinsByPath = new Map<string, Set<string>>();
  for (const r of pins) {
    (pinsByPath.get(r.provenBy) ??
      pinsByPath.set(r.provenBy, new Set()).get(r.provenBy)!).add(r.pin);
  }
  const claimPaths = new Set(claims.map((c) => c.provenBy));

  for (const c of claims) {
    const file = `${root}/${c.provenBy}`;
    if (!(await exists(file))) {
      failures.push(
        `MISSING provenBy file: ${c.provenBy}  (claim: "${c.claim}")`,
      );
      continue;
    }
    const recorded = pinsByPath.get(c.provenBy);
    if (!recorded || recorded.size === 0) {
      failures.push(
        `NO README PIN row for provenBy: ${c.provenBy}  (claim: "${c.claim}")`,
      );
      continue;
    }
    const full = await gitBlobHash(await Deno.readFile(file));
    for (const pin of recorded) {
      if (!full.startsWith(pin)) {
        failures.push(
          `STALE PIN ${c.provenBy}: README=${pin} actual=${
            full.slice(0, pin.length)
          }`,
        );
      }
    }
  }

  // README cites a proof file that no trellis claim backs → the generated table
  // and the source-of-truth contract have desynced.
  for (const r of pins) {
    if (!claimPaths.has(r.provenBy)) {
      failures.push(
        `README claims table cites ${r.provenBy}, but trellis.json has no matching claim`,
      );
    }
  }

  return {
    name: "descriptor",
    ok: failures.length === 0,
    failures,
    notes: [
      `${claims.length} trellis claims checked against ${pins.length} README pin rows`,
    ],
  };
}
