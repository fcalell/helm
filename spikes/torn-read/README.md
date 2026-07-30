# Torn read

Whether a reader outside the write queue can see a board file half-written, measured on both sides
of story 005-07's atomic-write change. Run on node v24.11.1.

```
node spikes/torn-read/probe.ts
```

`probe.ts` alternates two versions of one 40 KB story file while a second task reads the same path
20000 times, and counts every read that throws or equals neither version. It runs two arms in one
process: a control writing the target with a bare `writeFile`, the shape `writeStory` had before
this change, and the product's `writeStory`, which now fills a dot-prefixed temp in the same
directory and renames it into place.

```
node v24.11.1, body 40000 bytes
control (writeFile): 11055 torn in 20000 reads (55.27%), 19923 writes
product (writeStory): 0 torn in 20000 reads (0.00%), 16978 writes
control sees a tear: true; product is clean: true
```

A second run agreed: 11038 torn for the control, 0 for the product, over 20000 reads each.

The control arm is the half that makes the other one mean anything: it proves the loop can catch a
tear at all. Every torn read it caught was `readFile` returning a string that matched neither
version, and the earlier measurement on `runRound`'s read (005-07's Goal) saw those surface as
`InvalidBoardFileError` "missing frontmatter fence", the truncate window rather than a partial
body. The rate here is far above the 2.8% the original story-sized measurement saw because this
loop does nothing but write, so the reader lands inside the truncate window far more often.

Nothing imports this probe. It reaches into `src/board/` directly and writes only under a
`mkdtemp` directory it removes on exit; it exits 1 when either half fails.
