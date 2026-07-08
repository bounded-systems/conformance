// The ONLY writer of the surface golden. Regenerate on an intentional guest-room
// surface change and commit the diff — the golden diff is the reviewable record
// of the API change.
//
//   deno task surface:update                          # resolves ../guest-room
//   deno task surface:update --guest-room=/path/to/gr
//
// Delegates to @bounded-systems/drift-gate's writeGolden: the golden is a pure
// function of (surface, toolchain, guest-room rev) — no timestamp — so re-running
// with nothing changed is idempotent (no diff).
import { writeGolden } from "@bounded-systems/drift-gate";
import { type GateConfig, parseArgs, resolveGuestRoom } from "./lib.ts";

const GOLDEN = "goldens/guest-room.mod.surface.json";

const args = parseArgs(Deno.args);
const config: GateConfig = JSON.parse(
  await Deno.readTextFile("gate.config.json"),
);
const root = await resolveGuestRoom(args, config);

// Best-effort rev for provenance (informational only).
let rev = config.guestRoom.rev ?? "unknown";
try {
  const p = new Deno.Command("git", {
    args: ["-C", root, "rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "null",
  });
  const { code, stdout } = await p.output();
  if (code === 0) rev = new TextDecoder().decode(stdout).trim();
} catch { /* git optional */ }

const golden = await writeGolden(
  GOLDEN,
  `${root}/${config.guestRoom.modEntry}`,
  rev,
);
console.log(
  `✓ wrote ${GOLDEN} — ${golden.symbols.length} symbols (guest-room ${
    rev.slice(0, 12)
  })`,
);
