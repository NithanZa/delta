# Contributing to Delta

Delta researches a company's competitors and sends a weekly digest. People act on what it says, so the rule that shapes every change is simple: **never make Delta less trustworthy.** A wrong price in a digest costs more than a missing feature.

## Set up

You need Node 22. Delta's tests don't need any API keys.

```bash
npm install
cp .env.example .env.local
npm run demo:restore    # a populated database, with no model calls
npm run dev             # http://localhost:3000
```

This repo uses npm: keep `package-lock.json` as the only lockfile.

This project uses Next.js 16, which differs from older versions. Before changing anything under `src/app`, read the relevant guide in `node_modules/next/dist/docs/`.

## Before you open a pull request

CI runs these three, and all must pass:

```bash
npm run check                                     # types and lint
npm test                                          # offline, using a mock model
npm run eval:gates -- --db data/demo/delta.demo.db  # trust gates
```

If you change a prompt or a response schema, also run this against real models. It needs an API key and costs money, so CI doesn't run it:

```bash
npm run eval:regress
```

Say in your pull request which models you ran it on and what the result was. If you can't run it, say that instead, and a maintainer will.

## Rules that protect trust

- **Quotes are verbatim.** Every fact quotes its source word for word. Gate G1 enforces this.
- **Nothing leaks past a cutoff.** A run only sees pages dated on or before its cutoff.
- **Partners are authoritative only about their own company.** What they say about a competitor is stored as an attributed internal note. It moves a hypothesis by at most 0.1 and is never presented as public fact.
- **Don't weaken a gate or a regression case to get a change through.** If one looks wrong, explain why in its own pull request.

`docs/research/ground-truth-audit-2026-11-02.md` explains where these rules came from.

## Making changes

- **Tests stay offline.** Anything that uses the network takes an injectable `fetchImpl`, and model calls go through `MockLlmClient`.
- **Model calls use the Vercel AI SDK**, through the `LlmClient` interface, never a vendor's SDK directly.
- **Schema changes** go through `npx drizzle-kit generate --name <slug>`. Databases migrate when they're opened. If you add a table, also add it to the list in `src/db/schema.test.ts`.
- **Digest wording** follows the style in `src/lib/digest/`: only the most notable items, in plain language a reader can follow without knowing how Delta works.

To add a data source or a model provider, see [docs/extending.md](docs/extending.md).

## What's likely to be accepted

Delta is in a pilot with a design partner, and that pilot decides what gets built next. Bug fixes, trust fixes, tests and documentation are welcome at any time. For a larger feature, please open an issue first. `docs/plans/mvp/initial-mvp-thoughts.md` lists what's being considered and what each item is waiting on.

## License

By contributing, you agree that your work is released under the [MIT license](LICENSE).
