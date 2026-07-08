// The ONLY writer of the surface golden. Regenerate on an intentional guest-room
// surface change and commit the diff — the golden diff is the reviewable record
// of the API change.
//
//   deno task surface:update                          # resolves ../guest-room
//   deno task surface:update --guest-room=/path/to/gr
//
// The golden is a pure function of (surface, deno version, guest-room rev) — no
// timestamp — so re-running with nothing changed is idempotent (no diff).
import { extractSurface } from "./normalize-surface.ts";
import { type GateConfig, parseArgs, resolveGuestRoom } from "./lib.ts";

const GOLDEN = "goldens/guest-room.mod.surface.json";

const args = parseArgs(Deno.args);
const config: GateConfig = JSON.parse(
  await Deno.readTextFile("gate.config.json"),
);
const root = await resolveGuestRoom(args, config);
const surface = await extractSurface(`${root}/${config.guestRoom.modEntry}`);

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

const golden = {
  _generated: {
    by: "deno task surface:update",
    denoVersion: Deno.version.deno,
    guestRoomRev: rev,
    note:
      "Regenerate on an intentional guest-room surface change; commit the diff. Must be generated with the deno version pinned in CI (see gate.config.json deno.pinnedInCI).",
  },
  module: surface.module,
  symbols: surface.symbols,
};

await Deno.mkdir("goldens", { recursive: true });
await Deno.writeTextFile(GOLDEN, JSON.stringify(golden, null, 2) + "\n");
console.log(
  `✓ wrote ${GOLDEN} — ${surface.symbols.length} symbols (deno ${Deno.version.deno}, guest-room ${
    rev.slice(0, 12)
  })`,
);
