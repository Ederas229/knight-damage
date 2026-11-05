<!--
SPDX-FileCopyrightText: 2022 Johannes Loher

SPDX-License-Identifier: MIT
-->

# knight-damage

Please add your description here.

## Installation

Please add your installation instructions here.

## Development

### Prerequisites

In order to build this module, recent versions of `node` and `npm` are
required. Most likely, using `yarn` also works, but only `npm` is officially
supported. We recommend using the latest lts version of `node`. If you use `nvm`
to manage your `node` versions, you can simply run

```
nvm install
```

in the project's root directory.

You also need to install the project's dependencies. To do so, run

```
npm install
```

### Building

You can build the project by running

```
npm run build
```

Alternatively, you can run

```
npm run build:watch
```

to watch for changes and automatically build as necessary.

### Linking the built project to Foundry VTT

In order to provide a fluent development experience, it is recommended to link
the built module to your local Foundry VTT installation's data folder. In
order to do so, first add a file called `foundryconfig.json` to the project root
with the following content:

```
{
  "dataPath": ["/absolute/path/to/your/FoundryVTT"]
}
```

(if you are using Windows, make sure to use `\` as a path separator instead of
`/`)

Then run

```
npm run link-project
```

On Windows, creating symlinks requires administrator privileges, so
unfortunately you need to run the above command in an administrator terminal for
it to work.

You can also link to multiple data folders by specifying multiple paths in the
`dataPath` array.

### Testing

#### Unit tests

The unit suite (vitest) is fast (under a second) and runs in CI after lint:

```
npm test
```

Lint and format with `npm run lint` / `npm run format`; staged files are
linted and formatted automatically by a pre-commit hook, which also runs the
unit suite.

#### End-to-end tests

The e2e suites boot a real Foundry VTT v14 instance driven by
[foundryvtt-test-framework] (Playwright + a dice-override extension). They are
**local-only and never run in CI**. They require:

- a licensed local Foundry VTT v14 installation;
- a clone of `foundryvtt-test-framework` as a sibling of this repository
  (`../foundryvtt-test-framework`), with the Foundry Node server placed inside
  it as `FoundryVTT-Node/` (a copy of the portable install's
  `App/resources/app` works);
- a `tests/e2e/config.mjs` file (copy `tests/e2e/config.example.mjs` and
  adjust the paths). It is gitignored and references a license copy — never
  commit it.

One-time setup (re-run whenever the test world or the built module is stale):

```
npm run prepare:e2e
npm run setup:e2e
```

Then run the full chain — all six suites in series, fail-fast, one Foundry
boot each (roughly 10 minutes total):

```
npm run test:e2e:all
```

Or run individual suites: `npm run test:e2e` (smoke),
`test:e2e:fixtures`, `test:e2e:damage`, `test:e2e:vehicule-mecha`,
`test:e2e:reminders`, `test:e2e:hooks-sheets`.

Notes:

- Suites restore every world mutation they make, so back-to-back runs without
  `setup:e2e` are valid; a repo-root lock file serializes e2e scripts even
  when launched concurrently.
- The recorded chat-attack fixtures under `tests/e2e/fixtures/` are
  byte-frozen; re-record them only as one chain,
  `npm run setup:e2e && npm run record:e2e`.
- The committed test world seed lives under `tests/e2e/world-seed/`; the
  world copy inside `test-data/` is disposable.

See `docs/testing-plan.md` for the full testing plan, live-behavior findings,
and known gotchas, and `AGENTS.md` for per-suite details.

### Creating a release

The workflow works basically the same as the workflow of the [League Basic JS Module Template], please follow the
instructions given there.

## Licensing

This project is being developed under the terms of the
[LIMITED LICENSE AGREEMENT FOR MODULE DEVELOPMENT] for Foundry Virtual Tabletop.

Please add your licensing information here. Add your chosen license as
`LICENSE` file to the project root and mention it here.  If you don't know which
license to choose, take a look at [Choose an open source license].

[League Basic JS Module Template]: https://github.com/League-of-Foundry-Developers/FoundryVTT-Module-Template
[foundryvtt-test-framework]: https://github.com/Tiamanti/foundryvtt-test-framework
[LIMITED LICENSE AGREEMENT FOR MODULE DEVELOPMENT]: https://foundryvtt.com/article/license/
[Choose an open source license]: https://choosealicense.com/
