# FSF Copyright Assignment — Octave digraph/graph contribution

GNU Octave, like most GNU projects, requires contributors to assign
copyright of non-trivial contributions to the Free Software Foundation
before patches can be merged upstream. The digraph/graph work tracked
in `prd-octave-digraph-graph.md` is far over the trivial threshold (~10
lines or less), so the paperwork is a hard prerequisite for merge.

## Status

| Step                                          | Status   | Date       | Notes |
| :---                                          | :---     | :---       | :---  |
| 1. Request the form from `assign@gnu.org`     | pending  |            | Use `tasks/fsf-assignment-email.txt` as the body. |
| 2. Receive GNU `request-assign.future` form   | pending  |            | FSF auto-responder returns it within ~1 business day. |
| 3. Sign & return the form                     | pending  |            | Can be digital (OpenPGP) or paper. |
| 4. Receive confirmation from FSF clerks       | pending  |            | Usually a few days to a few weeks. |
| 5. Confirmation archived                      | pending  |            | Store under `tasks/fsf-assignment-confirmation/` (gitignored for privacy; keep a checksum here). |

Update the "Status" column as steps complete. When step 5 is done, the
draft PR on `gnu-octave/octave` can be flipped from "draft" to "ready
for review".

## Scope of assignment

The `request-assign.future` form covers all future contributions to
GNU Octave, not just this PR. A single signed form is sufficient for
this and every subsequent Octave contribution the signer makes. This
is preferable to the one-shot `request-assign.changes` form.

## References

- GNU Coding Standards — Copyright Papers:
  https://www.gnu.org/prep/maintain/html_node/Copyright-Papers.html
- Octave contribution guide:
  https://wiki.octave.org/Contribution_guidelines
- FSF Copyright FAQ:
  https://www.gnu.org/licenses/gpl-faq.html#AssignCopyright

## Notes

- The assignment is for copyright only. The signer retains all other
  rights, including the right to use the code in their own non-GPL
  projects (e.g. bundling the same `.m` files in MatSlop under GPLv3 is
  fine — MatSlop is itself a GPL-compatible distribution).
- The paperwork is one-time, not per-patch.
- While paperwork is in flight, the draft PR can still be opened for
  review. Maintainers will just not merge until the assignment is
  recorded.
