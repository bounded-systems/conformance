# conformance — cross-repo structural-overlap audit

Repos scanned: `guest-room`, `conformance`, `trellis`, `trellis-kit`, `verbspec`, `drift-gate`

| check | status | detail |
| --- | :-: | --- |
| jscpd | ✅ | 1.65% dup (budget 3%), 1 cross-repo clone(s) |
| ast-grep | ✅ | 0 rule match(es) |

## Duplication (jscpd)

Overall: **1.65%** (77/4677 lines), budget 3%.

### Cross-repo clones

| repos | lines | allow | files |
| --- | :-: | :-: | --- |
| trellis ↔ trellis-kit | 7 | ✅ | `trellis/check/lattice.ts` / `trellis-kit/mod.ts` |

### Within-repo clones (informational)

- `trellis`: 7
- `drift-gate`: 1
- `guest-room`: 1

## Structural rules (ast-grep)

_No rule matches._

✓ overlap audit passed

