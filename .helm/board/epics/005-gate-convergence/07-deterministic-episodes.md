---
id: 005-07
status: backlog
depends: [005-05]
sessions: {}
---
# Deterministic episodes

## Goal

An episode that passes proves something; an episode that fails half the time proves nothing, and
two committed ones do exactly that. `one-flag` and `exhausted` each fail at roughly 50% in
isolation: `one-flag` 3 times in 6 runs ("timed out waiting for story 001-01 to reach Ready", once
"waiting for the proposing session to close"), `exhausted` 2 times in 4 ("timed out waiting for the
flag ... on the gate channel"). `one-flag` runs in `all`, so the suite reports 11/12 about a third
of the time; `exhausted` halts and shows its rate only when run by name. Both fail at the same rate
at `5f1461c` and at `7501327`, so neither came from 005-06. Measured while reviewing 005-06, whose
own verification had to run each new episode in isolation to tell a real failure from this noise.

This is the instrument 005-05 committed so a flagged round, a contested flag and an exhausted
attempt are checkable at zero pool cost, and every later story in this epic grades its `(live)`
criteria against it. A suite read as flaky is a suite nobody reads.

Where the evidence points, without settling the fix: the observer holds `gate`, `board` and
`proposal` as last-write-wins values overwritten by each pushed frame (`observer.ts:81-114`), while
`waitFor` samples them every 50ms against a 45s deadline (`:35-36`, `:133-143`). A state that lives
less than one poll between two frames is therefore unobservable. The observer already keeps
`phases`, `flagStatuses`, `maxRounds` and `closed` as accumulated history for that exact reason
(`:51-56`), but `waitForFlag` (`driver.ts:154-169`), `waitForPhase` (`episodes.ts:92-99`) and
`waitForReady` (`driver.ts:222-238`) all probe the live snapshot instead. The open question this
story refines against: is every one of those timeouts the sampling race, or does a real ordering
bug in the gate sit under the two episodes that reach the deepest into it? A fix that widens
deadlines or accumulates more history would hide the second, so the diagnosis lands before the
repair, and the repair carries the measurement that shows the rate at zero.
