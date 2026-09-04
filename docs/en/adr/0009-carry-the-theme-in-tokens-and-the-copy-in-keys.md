# 9. Carry the theme in tokens and the copy in keys

Status: accepted

## Context

The interface was written in one language and one palette, both of them inline.
Every component named a colour through a Tailwind class such as `bg-abyss-800`,
and every phrase was a literal in the JSX beside it. Two readers wanted the two
things the code had no room for: a second language, and a light interface.

The chart is the awkward half. It is painted on a canvas, which the cascade
cannot reach, and its heat ramp is a lookup table built once and reused for
every frame. A theme that only reached the DOM would leave the one element the
product exists for still painted for the dark.

## Decision

The palette is a scale of roles — `abyss` for ground, `ink` for contrast — and a
theme re-points those roles rather than renaming them. Components keep the class
they always had; the light theme redefines the same custom properties under a
`data-theme` attribute on the root element. The canvas is given the same switch
by hand: the painters share one palette object that is reassigned in place, and
the depth ramp is discarded so the next paint rebuilds it from the light stops.

The ramp is not the dark one inverted. On paper, depth has to accumulate ink
rather than light, and the alpha climb that reads as empty water on black reads
as dirt on white — so the light ramp holds its cold end nearly clear and spends
its opacity late.

Copy is named, not written, everywhere it leaves the component: `failureKey`
travels through the chart's state instead of a sentence, so the controller never
decides what language a reader speaks. The English dictionary is the source of
the key type, which makes a missing Portuguese phrase a compile error rather
than a blank line on screen.

Numbers and clocks follow the same switch. A thousands separator is read
against the phrase beside it, so a price grouped by one language next to a size
grouped by another reads as a decimal point in the wrong place. The clock is
pinned to twenty-four hours in every language instead: a market chart reads its
times against each other, and the axis truncates the clock by character count,
which a trailing meridiem would carry into the label.

Everything that varies by language is a key, including the parts that look like
notation: the abbreviation of a duration, and the labels on the window presets.
An architecture test refuses a phrase written anywhere else — a spoken attribute
holding a literal, a line of prose typed into JSX, or prose assembled from a
template in the painting layer, which no rule about JSX would ever see. Adding a
third language is then a matter of writing one file, not searching for what the
last two missed.

Nothing a driver wrote reaches the screen. A caught failure is named — a saved
setting that would not save says so in the reader's language, and the driver's
own sentence goes to the console, where whoever can act on it is looking.

## Consequences

Adding a language is one file and no component changes. Adding a colour to the
palette means adding it to both themes, and forgetting one is visible rather
than silent, because the token would be undefined in that theme.

The theme choice defaults to whatever the host asks for and stops following it
the moment the reader chooses, which is the behaviour every other application on
their screen has.
