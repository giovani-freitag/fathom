# @giovani-freitag/fathom

The type surface a [Fathom](https://github.com/giovani-freitag/fathom) **reading**
is written against — an indicator written in the page itself.

**Types only.** There is no runtime here: a reading runs inside Fathom, which
provides the implementation. This package exists so a repository of readings can
typecheck against exactly what the in-page editor compiles against, rather than
against a copy somebody kept up to date by hand.

```bash
npm i -D @giovani-freitag/fathom
```

```ts
import { Plot } from 'fathom';
import type { Indicator, IndicatorInput, PlanDraft } from 'fathom';
```

For `'fathom'` to resolve, map it in your `tsconfig.json`:

```json
{
    "compilerOptions": {
        "paths": { "fathom": ["./node_modules/@giovani-freitag/fathom/fathom.d.ts"] }
    }
}
```

Generated out of Fathom's own source on every release, and held to it by an
architecture test — it cannot say something the editor does not.

Worked examples: [fathom-addons](https://github.com/giovani-freitag/fathom-addons).
Guide: [Writing a reading](https://github.com/giovani-freitag/fathom/blob/main/docs/writing-a-reading.md).

MIT.
