# Writing style: prose & copy

> **Load when:** writing any prose (`.knowledge/` docs, playbooks, README/comments-as-prose,
> commit/PR bodies, and user-facing UI copy).

Write so a careful human reader can't tell a machine drafted it. Lead with the claim, use plain
words, stop when the point lands.

## Sentences

- **State facts with `is` / `are` / `has`.** "The lock is a file", not "serves as / stands as /
  represents / acts as / functions as a file".
- **Assert the positive directly.** Say what a thing is: "The tag marks the released commit." Drop
  the "not X, but Y" and "not just X, it's Y" framing; keep only the Y.
- **Vary sentence length.** Follow a long, qualified sentence with a short one. Uniform mid-length
  rhythm is the loudest tell.
- **Open with the subject.** Start most sentences on the thing being discussed. Keep a connective
  ("so", "but", "then") only when the logic genuinely turns; delete "Moreover", "Furthermore",
  "Additionally", "Consequently", "In addition" when the next sentence already follows.
- **Finish the participle as its own clause.** Prefer "This refreshes the cache, so reads stay warm."
  over a trailing "…, ensuring reads stay warm" or "…, highlighting the importance of X". If the tail
  only comments on significance, cut it.

## Words

- **Reach for the plain word.**

  | Instead of                                        | Write                            |
  | ------------------------------------------------- | -------------------------------- |
  | utilize · leverage                                | use                              |
  | facilitate · enable (as filler)                   | let · help                       |
  | in order to                                       | to                               |
  | delve into · dive into                            | cover · examine                  |
  | a wide range of · a variety of                    | name them, or "several"          |
  | robust · powerful · seamless · rich · vibrant     | say what it does                 |
  | crucial · pivotal · vital · essential · key       | say why it matters, or cut it    |
  | testament to · underscores · highlights           | state the fact plainly           |

- **Repeat the exact term.** Call the same thing by the same name each time. Forced synonyms ("the
  card", then "the ticket", then "the story") signal machine variation; consistent terms read human
  and search cleanly.
- **Keep the neutral register.** Describe with concrete nouns and numbers, not sales adjectives.
  "Runs 2 sessions concurrently" beats "boasts impressive parallelism".

## Structure

- **List the real members, however many.** Two is fine; five is fine. Pad nothing to hit three; a
  three-item list is legal only when three real items exist.
- **Attribute to a named source, or drop the claim.** Cite the file, the person, the doc. Delete
  "experts say", "studies show", "it's widely regarded", "some argue".
- **Say the thing without warming up.** Cut "It's important to note that", "It's worth mentioning",
  "In today's fast-paced world". Start on the content.
- **Stop when the point is made.** No "In conclusion" or "Overall" summary of a short piece, no
  bolted-on "Challenges and future prospects" section, no closing line about broader significance.

## Formatting

- **Write the em-dash out of prose.** The em-dash (`—`) is banned. Recast each one:
  - Parenthetical aside → wrap in commas, or parentheses for a true digression.
  - Elaboration or a list that follows a lead-in → colon.
  - Two independent clauses joined for drama → split into two sentences, or use a semicolon.
  - Abrupt "…, and the rest" tail → a fresh sentence.
- **Sentence-case headings.** "Release lock", not "The Release Lock Mechanism".
- **Bold a term once, at its definition.** Let the surrounding prose carry meaning after that.

## The tell test

Before shipping prose, reread the opening sentence of each paragraph: does it make a claim, or warm
up to one? Cut every warm-up. If a sentence could sit unchanged in any other doc, it says nothing;
replace it with the specific fact.
