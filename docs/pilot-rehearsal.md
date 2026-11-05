# Dress rehearsal

Run this end to end on the hosted instance before a real partner, with Loop standing in for the partner and Buffer and SocialPilot as competitors. Time each step. Save the results in `eval/results/rehearsal-<date>.md`: timings, cost per week per competitor, recall, the digest you received, and anything that felt wrong.

Before you start: `docs/deploy.md` is done, `npm run doctor` passes, and you have an inbox you can reply from.

1. **Onboard.** On `/onboarding`, enter Loop's site (put the content of `data/seed/company.json` on a throwaway page, or use a friendly startup's real site) and answer the clarifying questions.
2. **Add competitors.** Add Buffer and SocialPilot from their URLs. Accept the proposed watchlists and feeds, and check that pricing and agency or partner pages are ticked.
3. **Backfill.** Click "Backfill history" for both. Record duration and cost from the job logs on `/ops`.
4. **Discover.** Queue discovery from onboarding step 3 or `/ops`, or run `npm run discover -- --all` followed by `npm run discover -- --all --absence`. Check the Evidence tab: pages grouped by provider, kept pages with a reason, and absence-check cards.
5. **Run the cycle.** On `/ops`, press "Crawl all", then "Run now" for each competitor. Press "Run now" again and confirm the second job finishes `skipped` with a reason.
6. **Digest.** Set yourself as recipient in Settings and press "Digest now". Click Useful on one insight and Wrong on another. Press "Send a note" and submit a Buffer URL and two sentences, for example "our customers say Buffer's partner payouts are slow".
7. **Close the loop.** Run Buffer again. Confirm that the URL was processed, the note is cited as `internal · <you>`, no hypothesis moved more than 0.1 on it alone, your Wrong reaction shows on the insight and in the review queue on `/ops`, and `/ops` shows the funnel. Record an outcome and confirm the reaction leaves the queue. On `/usage`, confirm the week's spend is split by competitor.
8. **Measure.** Inside the web container:

   ```bash
   npm run eval:gates
   npm run eval:recall
   ```

9. **Test the safety net.** Tamper with a quote that the next digest will cite, press "Digest now", and confirm the digest is `held`, `ops.email` gets a message, and `/ops` lists it. Use "Send anyway" with a reason and confirm the override is recorded in `events`. Restore the quote afterwards, or re-run from a backup.

```sql
UPDATE facts SET quote = 'A sentence that is not on the page.' WHERE id = <a cited fact id>;
```

10. **Tune.** Adjust `src/lib/digest/thresholds.ts` and the discovery caps based on the digest you received. Run `npm run eval:regress` after any prompt change.
