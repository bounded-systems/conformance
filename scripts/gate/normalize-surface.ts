// Extract guest-room's exported symbol surface from mod.ts via `deno doc --json`
// and normalize it into a stable, diffable projection.
//
// deno doc emits `{ version, nodes: [...] }` (older/other deno builds may emit a
// bare array — both are handled). Each node carries volatile fields — source
// `location` and `jsDoc` text — that must NOT count as API drift; everything
// else in the per-kind `*Def` (params, types, optional flags, return types,
// type params, literal shapes) IS the surface. We strip the volatile fields and
// keep the structural def, then canonicalize key order so cosmetic reordering
// doesn't diff.
//
// The remaining cross-version risk is deno doc's JSON schema itself shifting
// between deno versions; the golden records the deno version it was generated
// with and CI pins the same one, so a deno bump is a reviewed golden regen.

export interface SymbolEntry {
  name: string;
  kind: string;
  def: unknown;
}

export interface Surface {
  module: string;
  symbols: SymbolEntry[];
}

const VOLATILE = new Set(["location", "jsDoc"]);

function stripVolatile(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (VOLATILE.has(k)) continue;
      out[k] = stripVolatile(val);
    }
    return out;
  }
  return v;
}

/** Recursively sort object keys so serialization is order-independent. */
export function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = canonical(src[k]);
    return out;
  }
  return v;
}

export async function extractSurface(
  modPath: string,
  denoBin = Deno.execPath(),
): Promise<Surface> {
  const cmd = new Deno.Command(denoBin, {
    args: ["doc", "--json", modPath],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(
      `deno doc failed (exit ${code}) for ${modPath}: ${
        new TextDecoder().decode(stderr)
      }`,
    );
  }
  // deno-lint-ignore no-explicit-any
  const parsed: any = JSON.parse(new TextDecoder().decode(stdout));
  const nodes = Array.isArray(parsed) ? parsed : parsed.nodes;
  if (!Array.isArray(nodes)) {
    throw new Error(`unexpected deno doc output for ${modPath}: no nodes[]`);
  }

  const symbols: SymbolEntry[] = nodes
    // deno-lint-ignore no-explicit-any
    .filter((n: any) =>
      n && n.name && n.kind !== "moduleDoc" && n.kind !== "import"
    )
    // deno-lint-ignore no-explicit-any
    .map((n: any) => {
      const defKey = Object.keys(n).find((k) => k.endsWith("Def"));
      const def = defKey ? stripVolatile(n[defKey]) : null;
      return {
        name: n.name as string,
        kind: n.kind as string,
        def: canonical(def),
      };
    })
    .sort((
      a,
      b,
    ) => (a.name === b.name
      ? a.kind.localeCompare(b.kind)
      : a.name.localeCompare(b.name))
    );

  return { module: modPath.split("/").pop() ?? modPath, symbols };
}
