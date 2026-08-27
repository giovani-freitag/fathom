# Changelog

## [0.8.0](https://github.com/giovani-freitag/fathom/compare/v0.7.0...v0.8.0) (2026-08-27)


### Features

* fetch candles and volume from the venue so the chart opens on history ([10700ab](https://github.com/giovani-freitag/fathom/commit/10700ab906106b538916e4105e39029291a4e923))


### Bug Fixes

* put the tool bar below the chart instead of floating it over the volume ([fb23eef](https://github.com/giovani-freitag/fathom/commit/fb23eefb1d5d41c08c956593715631260639dd91))

## [0.7.0](https://github.com/giovani-freitag/fathom/compare/v0.6.0...v0.7.0) (2026-08-27)


### Features

* fold the span presets into a menu where a bar has no room for them ([afd77f4](https://github.com/giovani-freitag/fathom/commit/afd77f44fd681cc7a9a651a31588491967f97cd3))

## [0.6.0](https://github.com/giovani-freitag/fathom/compare/v0.5.0...v0.6.0) (2026-08-27)


### Features

* drop the header and answer what it said where it belongs ([70350e7](https://github.com/giovani-freitag/fathom/commit/70350e716c845737c974d1931ae512e5dc32fbd0))
* fold the book into bands a reader can follow when the window widens ([441781e](https://github.com/giovani-freitag/fathom/commit/441781ea3308b42d59909438a3da885b88b6aa20))
* fold the rows over the price behind one control ([a178645](https://github.com/giovani-freitag/fathom/commit/a1786455aee38d2f90fe86b0f36b8523ba6f1fc4))
* gather every layer control into one panel in the dock ([25c7930](https://github.com/giovani-freitag/fathom/commit/25c79309a69e9cf027a2facb460863c0f7f3b92b))
* give a wide screen its bar back and a narrow one its dock ([2b6e34d](https://github.com/giovani-freitag/fathom/commit/2b6e34d46c3ab9f2702a05c9fd3a1d5f6460e92c))
* give every control one height and every layer one home ([036afb0](https://github.com/giovani-freitag/fathom/commit/036afb02febccb223051dfc9765aedcc3a41b070))
* keep every layer in the dock and open panels onto choices ([b804a70](https://github.com/giovani-freitag/fathom/commit/b804a7017ebda6c62f762a1a79004192a4899cd3))
* mark the chart up with price levels and trend lines ([484d799](https://github.com/giovani-freitag/fathom/commit/484d799ccfdd2003f146f79d69142e50cbdd77ef))
* move the chart's controls into the dock and add undo ([23c9620](https://github.com/giovani-freitag/fathom/commit/23c9620163b878185762ad568e22e8a5bcbb4432))
* open a mark's properties when it is selected ([eaf5f47](https://github.com/giovani-freitag/fathom/commit/eaf5f4733312d670b4ffc21ef59ef9cdeb9d2fcd))
* open an indicator's settings by tapping the line it drew ([2b33093](https://github.com/giovani-freitag/fathom/commit/2b33093d4c2883c25bef28e28b6ccd30a4dfccff))
* put the drawing tools along the bottom, with zones and colour ([dae6a4c](https://github.com/giovani-freitag/fathom/commit/dae6a4c13efd576756d4b0145cf22683408d2077))
* remove a mark with Delete and put the tool down with Escape ([aa1111a](https://github.com/giovani-freitag/fathom/commit/aa1111a5413b452202b1286dd6c3d891676657f8))
* reshape a mark by its ends and measure a move in money and percent ([b377567](https://github.com/giovani-freitag/fathom/commit/b377567cb115ee23831ef5486de8a8e945187536))


### Bug Fixes

* close a socket the venue already hung up on without waiting ([e4b5da5](https://github.com/giovani-freitag/fathom/commit/e4b5da56229c84cb19c35d3635997c43946b3940))
* close the live socket when the archive cannot answer ([485c0f3](https://github.com/giovani-freitag/fathom/commit/485c0f327c5740eb89b1ec7dc291ffe2732551f4))
* do not move a mark when a click meant to select it twitches ([70d63f1](https://github.com/giovani-freitag/fathom/commit/70d63f1ded1dc24b6f03ab5da5e7ddd8c81d3520))
* float the drawing tools as one island instead of a second bar ([3d72570](https://github.com/giovani-freitag/fathom/commit/3d72570a7438c29435cbea368b7ad5d7b22833a6))
* fold a recording gap that carries on from the one before it ([f49ecf2](https://github.com/giovani-freitag/fathom/commit/f49ecf2a0c425002235ba77c14126a4d3115781a))
* give a row over the chart only to a layer that reads something there ([a2ce111](https://github.com/giovani-freitag/fathom/commit/a2ce1115ee838658ef5de74da7d4b327cec49cb6))
* give a settings panel one shape for a section and one voice for a label ([1159d48](https://github.com/giovani-freitag/fathom/commit/1159d48617ad777d1bf9ddfc3a0aaf438d1b0b10))
* give the rule between two sections breath on both sides ([208785a](https://github.com/giovani-freitag/fathom/commit/208785a4c67b243af1dce92464126dcd50a91100))
* keep following a database channel whose connection died ([d08b1f1](https://github.com/giovani-freitag/fathom/commit/d08b1f17bb36f9dcc00fc9141438d97ea7967ef4))
* keep the drawing rail clear of the volume pane and the time axis ([7cabd95](https://github.com/giovani-freitag/fathom/commit/7cabd95a52d8fdba89bb7b5381b8d89f542260e2))
* let the browser collector finish writing before it is terminated ([8ec1364](https://github.com/giovani-freitag/fathom/commit/8ec13646ab883d49dd98af9b208a91fe353a3bb4))
* never draw one contract's liquidity onto another's chart ([d8d28c9](https://github.com/giovani-freitag/fathom/commit/d8d28c9ae66bc2f787412d1767f292873d3743c9))
* never drop the partition the collector is writing into ([d43ed2e](https://github.com/giovani-freitag/fathom/commit/d43ed2e304fe7daef61da5185c8d4608156e212a))
* never serve the working directory as the viewer ([eeceaef](https://github.com/giovani-freitag/fathom/commit/eeceaef80ab262cea257ba4834ca6bf6a1cce050))
* open a window no wider than what has been recorded into it ([c6c5fff](https://github.com/giovani-freitag/fathom/commit/c6c5fff415e34ffbe1b724ef65874d95cd4619e9))
* put a layer's name and its way out on one line, and size a menu to its trigger ([8237a63](https://github.com/giovani-freitag/fathom/commit/8237a6305f77612413796e21a357c88a4128fc05))
* read a blank instrument symbol as the default ([bff1319](https://github.com/giovani-freitag/fathom/commit/bff13195c7b2186e40b27637653383fc422291e2))
* refuse a chunk size that would never advance ([de4307b](https://github.com/giovani-freitag/fathom/commit/de4307bb153bde1c0c2695c6a1d892bcc1857a17))
* refuse a depth ladder the venue did not serve ([edca1cb](https://github.com/giovani-freitag/fathom/commit/edca1cb603e8ae6f53fa593726db099533aa649a))
* refuse a gateway whose frames this viewer cannot read ([e7026e4](https://github.com/giovani-freitag/fathom/commit/e7026e41d6cc471c595d705dc022027754a2a431))
* refuse a stream frame the venue did not send whole ([f4f7dd3](https://github.com/giovani-freitag/fathom/commit/f4f7dd3d76fdffa9a2497581af4ed54a1a407ece))
* report an unreadable gateway body as a gateway failure ([ed7a83a](https://github.com/giovani-freitag/fathom/commit/ed7a83a4ee99738834e3dc8328606dcf0b11c41c))
* say what Volume and VWAP are instead of showing their keys ([4800a57](https://github.com/giovani-freitag/fathom/commit/4800a577e4d78d70886b632c3fd14df24fc3f4b8))
* spend the bar budget on the newest bars, not the oldest ([4a901f5](https://github.com/giovani-freitag/fathom/commit/4a901f5cadfd3bf6e09a36aa03dbb1882681a2c6))
* stop a collector that came up during shutdown ([b6e0b85](https://github.com/giovani-freitag/fathom/commit/b6e0b856d3213b9ce14596a3d1860d463c909ec1))
* take the fuller reading of an execution bucket still filling ([23cad3b](https://github.com/giovani-freitag/fathom/commit/23cad3bcfaceb6bfdc82773599be014c5f5b8659))
* wrap a bar's four prices instead of running them off the panel ([e431cf8](https://github.com/giovani-freitag/fathom/commit/e431cf89afa76f185981ee8542007b6ea479af12))
* write what was queued while a flush was already running ([11fd1a1](https://github.com/giovani-freitag/fathom/commit/11fd1a1aa7f8aea335ebb6f1aee1f4714189a192))

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
