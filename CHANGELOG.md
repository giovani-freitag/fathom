# Changelog

## [0.5.0](https://github.com/giovani-freitag/fathom/compare/v0.4.0...v0.5.0) (2026-08-27)


### ⚠ BREAKING CHANGES

* give every layer a folder of its own
* draw volume from the bars instead of from the book

### Features

* add eight indicators and give an oscillator its own pane ([41ca2e2](https://github.com/giovani-freitag/fathom/commit/41ca2e21b5eb5e9293975873aadd5a3611836af6))
* agree with the reference formulas and take a source per indicator ([e9ea888](https://github.com/giovani-freitag/fathom/commit/e9ea88804620221d8b47fa578af79ef0873c78cf))
* colour volume by bar direction and scale a band to what is on screen ([aa4739e](https://github.com/giovani-freitag/fathom/commit/aa4739e51fe7c0695449b7da274055b599380818))
* configure a layer in the drawer, and offer nothing to open when there is nothing to tell ([b0ef4e8](https://github.com/giovani-freitag/fathom/commit/b0ef4e81aa925564195ff89058dfa75e568e13ad))
* drag a figure that has two ends instead of typing it ([1e12b60](https://github.com/giovani-freitag/fathom/commit/1e12b60767b5530bd5369d954bb82518163fa303))
* draw the price as candles, bars, a line or an area ([241f473](https://github.com/giovani-freitag/fathom/commit/241f473e08d76dfbb6254f0a5b259c69b85f8ce8))
* draw volume from the bars instead of from the book ([6951411](https://github.com/giovani-freitag/fathom/commit/6951411428a215f978b82ffb9a5502c2e78174b2))
* fold every reading of the book, and its collector, into one card ([fdb9d81](https://github.com/giovani-freitag/fathom/commit/fdb9d81ea0db8cd7b9e47d72ddf9072c70e457ec))
* give bars their volume and let two readings share a band ([ddd4440](https://github.com/giovani-freitag/fathom/commit/ddd444085fdd5616330e8dca5ec53099fddc8154))
* lay volume along the floor of the price pane instead of taking a band ([8ef5cff](https://github.com/giovani-freitag/fathom/commit/8ef5cff0d5437dd4f748c48012e437f8197ca92b))
* leave room after the newest bar and count it down ([7d1c86b](https://github.com/giovani-freitag/fathom/commit/7d1c86b3bf9a1b487c43b52b1d171a833d9bfee1))
* let the reader name how long a bar covers ([078128c](https://github.com/giovani-freitag/fathom/commit/078128cf658de69b1296504cacff1ed02cc279ca))
* put the book and the candles in the same list as the indicators ([f8b0b1e](https://github.com/giovani-freitag/fathom/commit/f8b0b1e02ad488705a031039685ec925cc5693bc))
* read the bar under the cursor beside the candles ([5a36db4](https://github.com/giovani-freitag/fathom/commit/5a36db42ff937e165bb5b05281316f40aeaa3286))
* the chart is a list of layers, and the book is one of them ([7dbd4b1](https://github.com/giovani-freitag/fathom/commit/7dbd4b162eadaa9440360be2d1ab01fb325d6a81))
* weight the average by what traded, and count the bar down ([015231d](https://github.com/giovani-freitag/fathom/commit/015231d8def794f780e30c16378e47db0023d2a9))


### Bug Fixes

* answer the newest bars volume live rather than nothing ([4f81fbe](https://github.com/giovani-freitag/fathom/commit/4f81fbe66bd5b7345e62cd5e97389c20ee54cf87))
* give every switch the same knob and the same travel ([06c4198](https://github.com/giovani-freitag/fathom/commit/06c4198c61ebe97c5a41b3f92946f5ed360425f8))
* hand the volume to a reader whose switch only ever defaulted off ([f6af9d0](https://github.com/giovani-freitag/fathom/commit/f6af9d02332cfa11f08c1dcb5c7943ec9f1da038))
* keep a shared band across a reload ([cb5d477](https://github.com/giovani-freitag/fathom/commit/cb5d477771aafa1fc76b1bc4e8c557ebdddc6148))
* keep the recording controls reachable when the book is not drawn ([48ee78d](https://github.com/giovani-freitag/fathom/commit/48ee78dd6c4b72493789268e0a985acf6adc9fa7))
* name the recording once, and the book what traders call it ([e1958fa](https://github.com/giovani-freitag/fathom/commit/e1958fae2a42d500873da9fc529dcb382743c128))
* one rule between sections, and an axis framed on what is drawn ([db65b73](https://github.com/giovani-freitag/fathom/commit/db65b7357d14ded36d707f9fe4ebb88fb9030a31))
* open the chart instead of a dead controller ([855d637](https://github.com/giovani-freitag/fathom/commit/855d6377e5a1397cdef4bf3ad10ece053720009d))
* refetch for a deeper indicator, keep cell keys exact, and let a period be typed ([34eb627](https://github.com/giovani-freitag/fathom/commit/34eb627f77d0e06c8d9d8dad334902c32c9ae447))
* refuse an unanswerable window on every route, not one ([7c5e13d](https://github.com/giovani-freitag/fathom/commit/7c5e13dfd9ca4978b004bd815cd51e7de91590be))
* settle the remaining review findings and clear the refactor residue ([2efe13d](https://github.com/giovani-freitag/fathom/commit/2efe13d33e086780c78bf4093d6f3a1d55afcf49))
* stop aggressor bubbles resizing and re-merging while the chart is dragged ([7552cae](https://github.com/giovani-freitag/fathom/commit/7552cae28bbf448a3ac93436b8c7e00b72342ea8))
* stop asking for a window the archive refuses to answer ([dfa6169](https://github.com/giovani-freitag/fathom/commit/dfa6169aff530d57fd1cc0d8b365ae1d9b539130))
* stop reporting a column width on a chart with no book ([c745398](https://github.com/giovani-freitag/fathom/commit/c7453987c03a053b3552ead09f2180d1dc8e00a6))
* survive a stored language or theme the build does not ship ([e190856](https://github.com/giovani-freitag/fathom/commit/e1908569a8a95dc970364207878653a002665f63))


### Performance Improvements

* fetch the book only for a chart that draws it ([ea04e4a](https://github.com/giovani-freitag/fathom/commit/ea04e4a4434a914543a5ad7b065916ee47f5e729))
* follow only the slice of the chart each control reads ([4ccf9c8](https://github.com/giovani-freitag/fathom/commit/4ccf9c8dc1cefca1392ca7eb031266a826438c7c))


### Code Refactoring

* give every layer a folder of its own ([38bbf4b](https://github.com/giovani-freitag/fathom/commit/38bbf4b6a4421f85fdeb6716b0addbea49c9ad72))

## [0.4.0](https://github.com/giovani-freitag/fathom/compare/v0.3.0...v0.4.0) (2026-08-26)


### ⚠ BREAKING CHANGES

* draw bars from a declared interval instead of the surface width

### Features

* draw bars from a declared interval instead of the surface width ([bbf0363](https://github.com/giovani-freitag/fathom/commit/bbf0363fd7144034c3ce8dbf6c12cb877d4dd7e6))
* draw what each bar was built from, and name it in the readout ([5ec3fd9](https://github.com/giovani-freitag/fathom/commit/5ec3fd92a1e96711b6b89819737d061bc54d21d4))
* pre-group book bars on the minute and hour grids ([a138e12](https://github.com/giovani-freitag/fathom/commit/a138e1298475880a889c78c01434d2b7ec51dbf1))
* run indicators as draw plans the host projects and clips ([ffe7ee9](https://github.com/giovani-freitag/fathom/commit/ffe7ee92a90273662a0f26e28430431d3f5edafc))
* serve price bars on a declared interval, with what built each one ([1e37c33](https://github.com/giovani-freitag/fathom/commit/1e37c331aa75865709e823a830874aa4eaaa48ec))


### Bug Fixes

* track the pointer against the plot, and record the history retention drops ([98a8c02](https://github.com/giovani-freitag/fathom/commit/98a8c02b583a85359cda21fbdd8958fe1efcfdca))

## [0.3.0](https://github.com/giovani-freitag/fathom/compare/v0.2.0...v0.3.0) (2026-08-26)


### ⚠ BREAKING CHANGES

* give both registrations one tail and one message type

### Features

* give both registrations one tail and one message type ([453143e](https://github.com/giovani-freitag/fathom/commit/453143e56f503a877fe15520bb672428c9c5f364))

## [0.2.0](https://github.com/giovani-freitag/fathom/compare/v0.1.0...v0.2.0) (2026-08-26)


### Features

* show which build is running and what changed in it ([55d50f6](https://github.com/giovani-freitag/fathom/commit/55d50f60256f05ae62dfaed0c0f91ccf98533873))


### Bug Fixes

* close the log before exit so the last lines reach the disk ([bf96fa8](https://github.com/giovani-freitag/fathom/commit/bf96fa8f2e69593aa9ee82c5af792ade8bb59473))
