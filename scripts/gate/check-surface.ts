// Check 2 — exported TS surface drift.
//
// Extract guest-room mod.ts's live exported surface and diff it against the
// checked-in golden (goldens/guest-room.mod.surface.json). Any added, removed,
// or signature-changed export is drift and fails the gate. The golden is the
// effective pin: an intentional API change is acknowledged by regenerating it
// (`deno task surface:update`) and committing the reviewable diff.
import { type CheckResult, type GateConfig } from "./lib.ts";
import {
  canonical,
  extractSurface,
  type SymbolEntry,
} from "./normalize-surface.ts";

const GOLDEN = "goldens/guest-room.mod.surface.json";

export async function checkSurface(
  root: string,
  config: GateConfig,
): Promise<CheckResult> {
  const failures: string[] = [];
  const goldenRaw = JSON.parse(await Deno.readTextFile(GOLDEN));
  const goldenSymbols: SymbolEntry[] = goldenRaw.symbols ?? [];
  const live = await extractSurface(`${root}/${config.guestRoom.modEntry}`);

  const key = (s: SymbolEntry) => `${s.name} [${s.kind}]`;
  const gMap = new Map(goldenSymbols.map((s) => [key(s), s]));
  const lMap = new Map(live.symbols.map((s) => [key(s), s]));

  for (const k of gMap.keys()) {
    if (!lMap.has(k)) failures.push(`REMOVED export: ${k}`);
  }
  for (const k of lMap.keys()) {
    if (!gMap.has(k)) failures.push(`ADDED export: ${k}`);
  }
  for (const [k, g] of gMap) {
    const l = lMap.get(k);
    if (!l) continue;
    if (JSON.stringify(canonical(g.def)) !== JSON.stringify(canonical(l.def))) {
      failures.push(`CHANGED signature: ${k}`);
    }
  }

  const notes = [
    `golden: ${goldenSymbols.length} symbols; live: ${live.symbols.length} symbols`,
  ];
  if (failures.length) {
    notes.push(
      "Intentional API change? Regenerate: deno task surface:update --guest-room=<path>, then commit the golden diff.",
    );
  }
  return { name: "surface", ok: failures.length === 0, failures, notes };
}
