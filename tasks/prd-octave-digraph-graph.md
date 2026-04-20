# PRD: `graph` and `digraph` classes for GNU Octave

## 1. Introduction / Overview

GNU Octave (as of the current `default` branch) does not implement MATLAB's
`graph` (undirected) and `digraph` (directed) classes. Any `.m` script that
uses graph-theory primitives (`G = digraph(src, dst); plot(G); p = shortestpath(G, s, t);` etc.)
errors out with "`digraph` function is not yet implemented in Octave."

This PRD scopes the **full MATLAB-parity implementation** of both classes,
delivered as:

- **Track A (MatSlop shim)** — bundle the same `.m` files inside MatSlop's
  `resources/octave-scripts/` so MatSlop users get working `graph`/`digraph`
  the instant they update. Ships as soon as the core construction + `plot`
  stories land.
- **Track B (Octave upstream PR)** — a single long-lived branch in
  `C:\Users\benki\Documents\RES\projects\octave` (GitHub fork of
  `gnu-octave/octave`) that follows Octave's contribution conventions
  (GPLv3 headers, texinfo docstrings, `%!test` BIST blocks, `module.mk`
  wiring) and ends as a draft PR targeting `gnu-octave:default`.

The two tracks share **one** source of truth — MatSlop `addpath`'s the
Octave fork's `scripts/graph/` directory in dev mode and copies it into
`resources/octave-scripts/` at package time.

## 2. Goals

- Full MATLAB R2024a-level parity for `graph` and `digraph` (every
  documented method behaves identically on identical inputs, within
  reasonable numerical tolerance).
- Full MATLAB parity for `GraphPlot` (the handle returned by `plot(G)`).
- Every method ships with `%!test` blocks that encode MATLAB reference
  output. Tests are written **before** implementation (TDD).
- Every method has a texinfo docstring matching Octave's in-house style.
- No new dependencies on Octave packages or external libraries beyond
  what `liboctave` and `libinterp` already link (no boost-graph, etc.).
  Pure `.m` where possible; oct-file only if algorithmic performance
  demands it (PageRank on 10⁶-edge graphs, etc.).
- Draft PR opened against `gnu-octave/octave` on GitHub with all BIST
  passing, Octave's own `make check` clean, and a NEWS entry.
- MatSlop users can run `siever.m` (and any other MATLAB-style graph
  script) with zero changes.

## 3. Non-Goals

- Toolbox-specific MATLAB additions that require external MATLAB
  toolboxes (e.g., Parallel Computing Toolbox overloads, `bioinformatics`
  graph extensions).
- `digraph`/`graph` interoperability with the `octave-networks-toolbox`
  package (user-space concern; they coexist fine).
- Changes to the Octave core C++ (`libinterp`, `liboctave`) except where
  an oct-file is strictly required for performance of one specific
  algorithm. No new builtins.
- Support for Octave ≤ 6.x. Target is current `default` (10.x / 11.x
  series); minimum supported is Octave 9.1 because of classdef
  improvements.
- Live-editable MATLAB `GraphPlot` interaction gestures (drag nodes in
  the plot). We ship a static plot; interaction can come later.

## 4. Functional Requirements (topical)

**FR-1 Construction.** `graph()`, `graph(A)`, `graph(s, t)`,
`graph(s, t, w)`, `graph(s, t, w, nodenames)`, `graph(s, t, w, NodeTable)`,
`graph(EdgeTable)`, `graph(EdgeTable, NodeTable)`, and the matching
`digraph(...)` overloads. Optional flags: `'omitselfloops'`, `'upper'`
/`'lower'` (for adjacency matrix input), `'multigraph'`.

**FR-2 Properties.** `G.Nodes` (table), `G.Edges` (table), read-only at
the user level; mutation via the dedicated `addnode`/`addedge`/… methods.

**FR-3 Queries.** `numnodes`, `numedges`, `successors` (digraph),
`predecessors` (digraph), `neighbors` (graph and digraph),
`indegree`/`outdegree`, `degree` (graph), `findnode`, `findedge`,
`edgecount`, `inedges`, `outedges`, `adjacency`, `incidence`,
`laplacian`, `ismultigraph`.

**FR-4 Mutation.** `addnode`, `addedge`, `rmnode`, `rmedge`,
`reordernodes`, `subgraph`, `flipedge` (digraph).

**FR-5 Traversal.** `bfsearch`, `dfsearch` with every documented
`Events` option (`discovernode`, `edgetonew`, `edgetodiscovered`,
`edgetofinished`, `finishnode`, `startnode`).

**FR-6 Structural algorithms.** `conncomp` with `'Type', 'weak'|'strong'|'connected'`,
`biconncomp` (graph only), `condensation` (digraph only), `toposort`
(digraph only), `isdag`, `transclosure`, `transreduction`, `simplify`.

**FR-7 Path algorithms.** `distances`, `shortestpath`, `shortestpathtree`,
`allpaths`, `allcycles` with every documented `Method` option
(`'unweighted'`, `'positive'`, `'mixed'`, `'acyclic'`).

**FR-8 Flow algorithms.** `maxflow`, `mincut` with every documented
algorithm option.

**FR-9 Centrality.** `centrality` with every documented kind (`'degree'`,
`'indegree'`, `'outdegree'`, `'closeness'`, `'incloseness'`,
`'outcloseness'`, `'betweenness'`, `'pagerank'`, `'eigenvector'`,
`'hubs'`, `'authorities'`).

**FR-10 Isomorphism.** `isisomorphic`, `isomorphism`.

**FR-11 Plotting.** `plot(G, 'Layout', L, …)` with every layout MATLAB
documents (`'auto'`, `'circle'`, `'force'`, `'force3'`, `'layered'`,
`'subspace'`, `'subspace3'`). Returns a `GraphPlot` handle.
`GraphPlot` exposes `highlight`, `labeledge`, `labelnode` and the
documented node/edge cosmetic properties.

**FR-12 Persistence.** `save` and `load` round-trip via Octave's native
MAT serialization. `display`/`disp` match MATLAB's output format
within reason.

## 5. Technical Considerations

- **Directory layout** — new `scripts/graph/` category in the Octave
  tree, added to the top-level `SUBDIRS` in `scripts/module.mk`.
  Each class lives in a single classdef file (`graph.m`, `digraph.m`,
  `GraphPlot.m`). Shared helpers go in `scripts/graph/private/`.
- **Shared internals** — `graph` and `digraph` delegate storage to an
  internal sparse adjacency representation held in a shared private
  helper (`scripts/graph/private/__graph_core__.m`) so we don't
  duplicate 80% of the logic.
- **Numeric representation** — adjacency stored as `sparse(n, n)` of
  edge weights (or `1` for unweighted). Edge table is a dense
  `(m × k)` table with columns `EndNodes` (m×2), `Weight` (optional),
  plus user columns. Node table has `Name` (optional) plus user
  columns.
- **Weights** — default `1` when absent. `double` storage; MATLAB
  permits integer weights for some algorithms — we allow them via
  coercion.
- **Performance targets** — `shortestpath` on a 10⁵-node random graph
  < 1 s on a modern laptop using Dijkstra with binary heap (pure `.m`
  is acceptable; drop to oct-file only if profiling demands it).
  PageRank iteration on a 10⁶-edge graph < 5 s.
- **Reproducibility of stochastic algorithms** — any algorithm that uses
  randomness (random layout seeding) must respect the global RNG state.
- **Platform coverage** — all BIST must pass on Linux/macOS/Windows
  (Octave's three supported platforms). Especially watch out for
  `plot` tests that need headless rendering (use `graphics_toolkit
  ('gnuplot')` in the BIST preamble).
- **Copyright header** — every new `.m` file starts with the 24-line
  GPLv3 header (see `scripts/audio/@audioplayer/audioplayer.m` lines
  1-24 for the exact template).
- **Docstring style** — texinfo, leading `## -*- texinfo -*-`, uses
  `@deftypefn`, `@var`, `@code`, `@example`/`@group`, `@seealso`.
- **Test style** — `%!test`, `%!assert`, `%!error`, `%!warning`, `%!shared`.
  Each user story adds at minimum: one happy-path `%!test`, one edge
  case (empty graph, self-loop, multigraph, disconnected), one
  `%!error` for bad inputs.

## 6. Success Metrics

- `siever.m` at `C:\Users\benki\Documents\ECE_6998\git\Reconfigurable-Flowpaths\matlab\siever.m`
  runs to completion in MatSlop with a figure displayed.
- `make check` in the Octave fork reports zero failures attributable
  to `scripts/graph/`.
- All methods listed in MATLAB R2024a `digraph`/`graph`/`GraphPlot`
  documentation have a corresponding `.m` method file with at least
  one `%!test` that matches MATLAB reference output (captured from an
  authorized MATLAB installation — see US-I05).
- The draft PR at `gnu-octave/octave` accumulates no "style nit" review
  comments (i.e., Octave maintainers only request algorithmic or
  design changes, not whitespace/format fixes).

## 7. User Stories

**Conventions for every story below:**

- Branch: `digraph-graph-classes` in `C:/Users/benki/Documents/RES/projects/octave`.
- TDD — write the `%!test` block first, run it, confirm failure, then
  implement until it passes.
- Acceptance always includes: GPLv3 header present, texinfo docstring
  passes `texi2any --lint`, `octave --no-init-file --eval "test
  scripts/graph/<file>.m"` reports `PASS`, `make check` regresses nothing.
- Each story ends with a commit on the branch using the message
  `feat: [US-ID] <title>` per Octave's "topic: brief" commit style,
  amended to include `Signed-off-by` once FSF paperwork lands.

### Phase 0 — Infrastructure

#### US-I01: Create `scripts/graph/` category and wire into build
**As a maintainer**, I want `scripts/graph/` to compile and install with
`make && make install` so later stories have a home.

- [ ] `scripts/graph/module.mk` created (empty `scripts_graph_FCN_FILES`).
- [ ] `scripts/graph/module.mk` listed in `scripts/module.mk` `SUBDIRS`.
- [ ] `scripts/graph/PKG_ADD` stub.
- [ ] `make && make install` succeeds with the new directory present.

#### US-I02: MatSlop shim wiring
**As a MatSlop user**, I want `digraph` / `graph` to resolve at the
Octave prompt the moment MatSlop starts.

- [ ] `octaveProcess.ts` adds the fork's `scripts/graph/` directory to
      `addpath` in dev mode (resolved relative to `C:/Users/benki/Documents/RES/projects/octave`).
- [ ] `resources/octave-scripts/` is populated at package time with a
      recursive copy of `scripts/graph/*.m` (wired into
      `electron-builder`'s `extraResources`).
- [ ] Unit test in `tests/unit/octave-process-graph-path.test.ts` that
      confirms the addpath statement is emitted.
- [ ] Integration test that boots Octave through MatSlop, runs
      `which digraph`, expects a non-empty path.

#### US-I03: Reference-output capture harness
**As an implementer**, I want MATLAB reference output for every
documented behavior captured as JSON so Octave `%!assert` blocks can
compare byte-for-byte.

- [ ] `tasks/matlab-reference/` scripts generating reference output for
      each user story's example (requires an authorized MATLAB
      installation — user runs these once per story).
- [ ] Output stored as `tasks/matlab-reference/<method>.json`
      (node/edge arrays + method result).
- [ ] Helper `scripts/graph/private/__matlab_ref__.m` loads a JSON ref
      and feeds it to `%!assert`.

#### US-I04: FSF copyright assignment tracking
**As the contributor**, I want to know the paperwork state so the PR
can land.

- [ ] `tasks/fsf-assignment.md` documents the steps
      (email `assign@gnu.org`, fill GNU form `request-assign.future`,
      wait for FSF response).
- [ ] Draft email ready to send.
- [ ] PR description tracks paperwork status.

### Phase 1 — Construction & core properties

*(Each story below lives as its own `.m` method file under `scripts/graph/`
or the shared internals directory, and the classdef file cross-references
it with a `@method` declaration.)*

#### US-C01: `digraph()` default constructor
- [ ] `digraph()` returns an empty directed graph; `numnodes` = 0.
- [ ] `digraph(N)` (integer) makes an N-node edgeless digraph.
- [ ] `%!test` for both forms.

#### US-C02: `digraph(s, t)` edge-list constructor (numeric endpoints)

#### US-C03: `digraph(s, t, w)` with weights

#### US-C04: `digraph(s, t, w, nodenames)` with string node names

#### US-C05: `digraph(s, t, w, N)` with integer node count (sparse node set)

#### US-C06: `digraph(A)` adjacency matrix constructor (numeric)

#### US-C07: `digraph(A, nodenames)` adjacency + names

#### US-C08: `digraph(EdgeTable)` and `digraph(EdgeTable, NodeTable)`

#### US-C09: `'omitselfloops'` flag on all constructors

#### US-C10: `'multigraph'` flag

#### US-C11: `graph()` default and numeric-endpoints constructors

#### US-C12: `graph(A)` — adjacency matrix, with `'upper'`/`'lower'`
- [ ] Non-symmetric adjacency with neither flag errors with MATLAB-compatible message.

#### US-C13: `graph(EdgeTable[, NodeTable])`

#### US-C14: `Nodes` and `Edges` property getters (return the backing tables)

#### US-C15: `disp(G)` / `display(G)` formatted output matching MATLAB

### Phase 2 — Queries

#### US-Q01: `numnodes(G)`, `numedges(G)`
#### US-Q02: `successors(G, node)` / `predecessors(G, node)` (digraph)
#### US-Q03: `neighbors(G, node)` (graph and digraph)
#### US-Q04: `indegree(G[, nodes])` / `outdegree(G[, nodes])` (digraph)
#### US-Q05: `degree(G[, nodes])` (graph)
#### US-Q06: `findnode(G, name)` → index; `findnode(G, idx)` → validation
#### US-Q07: `findedge(G, s, t)` with all 3 call forms (single, pair, vectorized)
#### US-Q08: `edgecount(G, s, t)` (multigraph-aware)
#### US-Q09: `inedges(G, n)` / `outedges(G, n)` (digraph)
#### US-Q10: `adjacency(G[, weights])` returns sparse
#### US-Q11: `incidence(G)` returns sparse (digraph: ±1, graph: 1)
#### US-Q12: `laplacian(G)` returns sparse (only for undirected `graph`)
#### US-Q13: `ismultigraph(G)` scalar logical

### Phase 3 — Mutation

#### US-M01: `addnode(G, N)`, `addnode(G, nodenames)`, `addnode(G, NodeTable)`
#### US-M02: `addedge(G, s, t)`, `addedge(G, s, t, w)`, `addedge(G, EdgeTable)`
#### US-M03: `rmnode(G, nodes)`
#### US-M04: `rmedge(G, s, t)`, `rmedge(G, idx)`
#### US-M05: `reordernodes(G, perm)`
#### US-M06: `subgraph(G, nodes)` returns new `digraph`/`graph`
#### US-M07: `flipedge(G)` (digraph)

### Phase 4 — Traversal

#### US-T01: `bfsearch(G, s)` with default options
#### US-T02: `bfsearch(G, s, Events)` for all event kinds
#### US-T03: `dfsearch(G, s)` with default and `Events` option
#### US-T04: `'Restart'` and `'EdgeColors'` options on bfsearch/dfsearch

### Phase 5 — Structural algorithms

#### US-S01: `conncomp(G, 'Type', 'weak')` (default for digraph) / `'strong'` (Tarjan)
#### US-S02: `conncomp(G)` for `graph` (standard connected components)
#### US-S03: `biconncomp(G)` (graph only)
#### US-S04: `condensation(G)` (digraph → DAG of SCCs)
#### US-S05: `toposort(G)` with `'Order', 'stable'|'lexicographic'`
#### US-S06: `isdag(G)`
#### US-S07: `transclosure(G)` (digraph)
#### US-S08: `transreduction(G)` (digraph)
#### US-S09: `simplify(G[, rule])` — aggregate multi-edges

### Phase 6 — Path algorithms

#### US-P01: `distances(G)` all-pairs — default Dijkstra
#### US-P02: `distances(G, src)`, `distances(G, src, tgt)`
#### US-P03: `'Method'` option: `'unweighted'`, `'positive'`, `'mixed'`, `'acyclic'`
#### US-P04: `shortestpath(G, s, t)` returns path + length + edge indices
#### US-P05: `shortestpathtree(G, s)` returns predecessor tree as `digraph`
#### US-P06: `allpaths(G, s, t, 'MaxPathLength', k)` enumeration
#### US-P07: `allcycles(G)` with `'MinCycleLength'` / `'MaxCycleLength'`
#### US-P08: Bellman-Ford for negative weights
#### US-P09: Johnson's algorithm for all-pairs with negative weights (no negative cycles)

### Phase 7 — Flow algorithms

#### US-F01: `maxflow(G, s, t)` default (Ford-Fulkerson via BFS = Edmonds-Karp)
#### US-F02: `maxflow(G, s, t, 'augmentpath')` and `'searchtrees'` options
#### US-F03: `mincut(G, s, t)` returns cut value + partition + crossing edges

### Phase 8 — Centrality

#### US-CT01: `centrality(G, 'degree')` / `'indegree'` / `'outdegree'`
#### US-CT02: `centrality(G, 'closeness')` / `'incloseness'` / `'outcloseness'`
#### US-CT03: `centrality(G, 'betweenness')` (Brandes' algorithm)
#### US-CT04: `centrality(G, 'pagerank')` with `'FollowProbability'`, `'MaxIterations'`, `'Tolerance'`
#### US-CT05: `centrality(G, 'eigenvector')` power iteration
#### US-CT06: `centrality(G, 'hubs')` / `'authorities'` (HITS)
#### US-CT07: `'Cost'` and `'Importance'` weight options on all centrality kinds

### Phase 9 — Isomorphism

#### US-IS01: `isisomorphic(G1, G2)` (VF2 or brute force for small graphs)
#### US-IS02: `isomorphism(G1, G2)` returns mapping or empty
#### US-IS03: `'NodeVariables'` / `'EdgeVariables'` label-matching options

### Phase 10 — GraphPlot class

#### US-GP01: `plot(G)` returns a `GraphPlot` handle using `'auto'` layout
#### US-GP02: `'Layout', 'circle'`
#### US-GP03: `'Layout', 'force'` (2D) — Fruchterman-Reingold
#### US-GP04: `'Layout', 'force3'` (3D)
#### US-GP05: `'Layout', 'layered'` — Sugiyama for digraphs
#### US-GP06: `'Layout', 'subspace'` / `'subspace3'` — spectral layout
#### US-GP07: `GraphPlot` node cosmetic properties (`NodeColor`, `MarkerSize`, `NodeLabel`, `NodeFontSize`, …)
#### US-GP08: `GraphPlot` edge cosmetic properties (`EdgeColor`, `LineWidth`, `LineStyle`, `ArrowSize`, `EdgeLabel`, …)
#### US-GP09: `highlight(h, nodes[, props])`
#### US-GP10: `highlight(h, s, t[, props])`
#### US-GP11: `highlight(h, 'Edges', idx[, props])`
#### US-GP12: `labeledge(h, idx, labels)`
#### US-GP13: `labelnode(h, nodes, labels)`
#### US-GP14: `plot(G, 'XData', …, 'YData', …, 'ZData', …)` explicit coords
#### US-GP15: MATLAB-compatible default colors/markers

### Phase 11 — Persistence & integration

#### US-PS01: `save`/`load` round-trip for `digraph` and `graph`
#### US-PS02: `subsref` / `subsasgn` on `G.Nodes` and `G.Edges`
#### US-PS03: Concatenation (`[G1, G2]`) error with MATLAB-compatible message
#### US-PS04: Copy semantics match MATLAB value-class behavior

### Phase 12 — Siever integration & regression

#### US-R01: `siever.m` runs end-to-end in MatSlop with a figure
#### US-R02: Full MATLAB R2024a digraph/graph documentation example suite
      runs green (one `.m` per doc page)
#### US-R03: Performance benchmark script (graphs of 10³, 10⁴, 10⁵, 10⁶ nodes)
      checked into `test/graph-bench.m`

### Phase 13 — Upstream submission

#### US-U01: `NEWS.md` entry added under "Graph and network analysis"
#### US-U02: `doc/interpreter/graph.txi` section with overview + minimal example
#### US-U03: FSF assignment paperwork completed and confirmed
#### US-U04: Final `make check` green on Linux, macOS, Windows CI
#### US-U05: Rebase to `gnu-octave/default` tip, squash fix-up commits, open draft PR
#### US-U06: Address PR review feedback until merged

## 8. Design Considerations

- MATLAB returns `digraph`/`graph` as **value classes** (not handles).
  Mutations return new objects. We match this exactly — `classdef` (no
  `< handle`).
- `GraphPlot` **is** a handle class in MATLAB (mutable plot object).
  We match with `classdef GraphPlot < handle`.
- `Nodes` and `Edges` are presented as MATLAB `table` objects. Octave
  has `struct`-of-arrays approximation; we'll expose them as structs
  with the same column names so user code that does `G.Edges.Weight`
  works. A full `table` class port is out of scope for this PRD but
  would obviate the shim.
- Plot output must work under `graphics_toolkit('gnuplot')` (MatSlop's
  default) AND `'qt'` / `'fltk'` (Octave defaults). The 2D layouts
  compute coordinates in pure `.m` then delegate to `line` / `scatter`
  for rendering, which works everywhere.

## 9. Open Questions

- **FSF copyright paperwork** — the user will sign the FSF future-
  assignment form (`request-assign.future@gnu.org`). Until that lands,
  the PR cannot merge; it can still be opened as a draft for review.
- **`table` class.** We'll stub with struct-of-arrays. When Octave ships
  real `table` support, `Nodes`/`Edges` migrate with a backwards-
  compatible shim.
- **Performance of pure-`.m` Brandes** — may need an oct-file; profile
  first under Phase 8.
- **VF2 vs nauty for `isisomorphic`** — nauty has a GPL-compatible
  license but is a separate C library. For now, VF2 in pure `.m`;
  revisit if perf inadequate.

---

*Branch name for Ralph: `digraph-graph-classes`. Working directory for
Ralph's Octave-side loop: `C:\Users\benki\Documents\RES\projects\octave`.
A parallel `prd.json` is generated from this document via the
`ralph-skills:ralph` skill for machine consumption.*
