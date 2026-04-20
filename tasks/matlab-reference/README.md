# MATLAB reference-output fixtures

This directory holds **MATLAB reference outputs** for the digraph/graph
implementation. Each fixture pins down the exact result MATLAB produces
for a specific method call on a specific input, so the Octave-side
`%!test` blocks in `scripts/graph/**/*.m` can assert byte-for-byte
compatibility.

## File layout

```
tasks/matlab-reference/
  README.md                   — this file
  <method>.m                  — MATLAB script that produces the fixture
  <method>.json               — captured output, consumed by
                                scripts/graph/private/__matlab_ref__.m
```

One `.m`/`.json` pair per user story in the PRD (see
`tasks/prd-octave-digraph-graph.md`). Each fixture is small and focused:
one call, one output.

## Capturing a fixture

1. Open MATLAB (any modern version; R2024a is the PRD target).
2. Run the fixture `.m` script. Example capture for the edge-list
   `digraph` constructor:

   ```matlab
   % numnodes.m  — captures numnodes(digraph(s,t)) for a 3-node chain
   s = [1 2 3];
   t = [2 3 1];
   G = digraph(s, t);
   result = struct( ...
       'method',   'numnodes', ...
       'input',    struct('s', s, 't', t), ...
       'expected', numnodes(G));
   fid = fopen('numnodes.json', 'w');
   fwrite(fid, jsonencode(result, 'PrettyPrint', true));
   fclose(fid);
   ```

3. Commit the `.m` capture script AND the resulting `.json` fixture.
4. On the Octave side, reference the fixture from the corresponding
   classdef method's `%!test` block:

   ```octave
   %!test
   %! ref = __matlab_ref__ ('numnodes');
   %! G = digraph (ref.input.s, ref.input.t);
   %! assert (numnodes (G), ref.expected);
   ```

## Why fixtures instead of hand-coded expected values?

- **Catches drift.** A hand-coded expectation can be wrong and still
  stay green — the test asserts whatever the author believed MATLAB
  did, not what MATLAB *actually* does.
- **Documents the contract.** The `.m` capture script is the
  unambiguous record of what input we're testing against.
- **Version-pinnable.** When MATLAB changes a default, the fixture
  changes with a visible diff instead of silently diverging.

## Which stories need fixtures?

Every story in `prd-octave-digraph-graph.md` whose acceptance criteria
include matching MATLAB reference output. That's most of Phase 1-9
(construction through centrality). Plot/cosmetic stories (Phase 10)
typically do not need fixtures because coordinates vary with layout
RNG; verify shape invariants instead.

## No MATLAB on hand?

Skip the fixture and write `%!test` against first-principles
invariants (e.g., `assert (numnodes (digraph (1:3, 2:4)), 4)`) in
the classdef file. Flag the story's PRD `notes` field with
`"needs matlab fixture"` so a fixture can be added later.
