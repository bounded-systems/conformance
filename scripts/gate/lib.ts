// Shared helpers for the conformance cross-repo drift gate.
//
// The gate reads another repo's source (guest-room) read-only and never mutates
// it. The checks themselves (descriptor honesty, surface diff) live in the shared
// @bounded-systems/drift-gate engine; this file only holds conformance-local glue:
// config shape, arg parsing, and resolving where guest-room is checked out.

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
