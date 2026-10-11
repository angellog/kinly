# Scoring

The score is a heuristic, not an endorsement. Licences are read from GitHub and must be checked before commercial use.

## Kinly score (0–100)

| Component | Max | How it is computed |
|---|---|---|
| Adoption | 30 | Up to 20 from stars on a log scale (100 stars gives 0, about 300k gives 20), plus up to 10 from star velocity. Velocity is the 7-day stars-per-day from stargazers history when it is fresh; otherwise the best day on a daily list |
| Maintenance | 20 | Last push: within 7 days scores 12, within 30 days 10, 90 days 7, 180 days 4, 365 days 2, older 0. Latest release: within 30 days scores 5, 90 days 4, 180 days 2, older 1. Plus 3 if the repository survived its first six months. An archived repository scores 0 |
| Persistence | 15 | 3 per distinct ISO week on any trending list, plus 0.3 per distinct day (up to 10 days) |
| Licence | 15 | Permissive 15, weak copyleft 11, unknown 5, strong copyleft 6, source-available 3, no licence 1. Open-core caps this at 6 |
| Relevance | 20 | Relevance (0–100) × 0.2 |

**Relevance (0–100)** has three parts:

- **Category weight**, up to 45: 45 × the owner's weight for the category.
- **Keyword hits**, up to 35: matches against the owner's business keywords, such as Instagram, carousel, MCP, Claude, WhatsApp, sneaker and e-commerce.
- **Star topics**, up to 20: overlap with topics that recur in the owner's GitHub stars.

## Verdict

- **BUILD**: total ≥ 70, relevance ≥ 50, and **not** source-available.
- **WATCH**: total 45–69, or ≥ 70 but failing one of the BUILD conditions.
- **SKIP**: total < 45, or archived.

The owner may override the verdict when rating a repository. The engine verdict and the owner's rating are always shown side by side.

## Picks

Picks are new and relevant, not merely big. A pick must meet all of these:

- it is not starred, not on the shortlist, and was not offered in the last 30 days;
- relevance ≥ 50 and score ≥ 45 for the daily report, or ≥ 60 and ≥ 55 for the weekly report.

Ranking is 0.6 × relevance + 0.4 × score, then:

- **+10** if the repository was first seen in the last 90 days or created in the last year;
- **−10** if it was first seen over a year ago and has had no release in 90 days.

No more picks are offered than there are free slots on the five-repository testing bench.

## Coverage caveats

- From 2025-04 to 2026-10-07, the only daily record is the larsbijl archive, which keeps Python, Go, Rust, C++, JavaScript and TypeScript lists only. Repositories that trended under other languages are missing from those months, so persistence in that window undercounts them.
- From 2026-10-08, Kinly collects the live all-languages, weekly and monthly lists plus ten per-language lists.
- Stargazers history counts star *creations*. Its sum can exceed the live star count because un-stars are not subtracted. The two numbers are stored separately and never reconciled.
