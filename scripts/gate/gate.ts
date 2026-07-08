// Conformance cross-repo drift gate.
//
// Unlike scripts/audit.mjs (which reports and always exits 0), this FAILS
// (exit 1) on drift. Two read-only checks against @bounded-systems/guest-room,
// both delegated to the shared @bounded-systems/drift-gate engine so conformance
// and trellis run a single source of truth:
//
//   Check 1 (descriptor) — trellis.json proof claims: each provenBy file exists
//            and its git blob hash matches the pin in guest-room's generated
//            README claims table.
//   Check 2 (surface)    — mod.ts's exported surface (ts-morph) matches the
//            checked-in golden.
//
// guest-room is read-only here. This is the external org-governance twin of the
// descriptor-kit check guest-room runs on itself; the product repo is never
// wired to this gate.
//
//   deno task gate                          # both checks, resolves ../guest-room
//   deno task gate:descriptor               # Check 1 only
//   deno task gate:surface                  # Check 2 only
//   deno task gate --guest-room=/path/to/gr
import {
  checkDescriptor,
  type CheckResult,
  checkSurface,
} from "@bounded-systems/drift-gate";
import { type GateConfig, parseArgs, resolveGuestRoom } from "./lib.ts";

const GOLDEN = "goldens/guest-room.mod.surface.json";

const args = parseArgs(Deno.args);
const only = typeof args.only === "string" ? args.only : null;
const config: GateConfig = JSON.parse(
  await Deno.readTextFile("gate.config.json"),
);
const root = await resolveGuestRoom(args, config);

const results: CheckResult[] = [];
if (!only || only === "descriptor") {
  results.push(
    await checkDescriptor({
      root,
      trellis: config.guestRoom.trellis,
      readme: config.guestRoom.readme,
    }),
  );
}
if (!only || only === "surface") {
  results.push(
    await checkSurface(`${root}/${config.guestRoom.modEntry}`, GOLDEN),
  );
}

const lines: string[] = [
  `# conformance gate — guest-room (${root})`,
  "",
  "| check | status | detail |",
  "| --- | :-: | --- |",
];
for (const r of results) {
  const status = r.skipped ? "⏭️" : r.ok ? "✅" : "❌";
  lines.push(
    `| ${r.name} | ${status} | ${
      r.ok ? r.notes.join("; ") : `${r.failures.length} failure(s)`
    } |`,
  );
}
lines.push("");
for (const r of results) {
  if (r.ok) continue;
  lines.push(`## ❌ ${r.name}`);
  for (const f of r.failures) lines.push(`- ${f}`);
  for (const n of r.notes) lines.push(`- _${n}_`);
  lines.push("");
}

const report = lines.join("\n");
console.log(report);

const summaryPath = Deno.env.get("GITHUB_STEP_SUMMARY");
if (summaryPath) {
  try {
    await Deno.writeTextFile(summaryPath, report + "\n", { append: true });
  } catch { /* non-fatal: summary is best-effort */ }
}

const ok = results.every((r) => r.ok);
console.log(
  ok ? "\n✓ gate passed — no drift" : "\n✗ gate FAILED — drift detected",
);
Deno.exit(ok ? 0 : 1);
