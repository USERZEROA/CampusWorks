# CampusWorks verification

The current local delivery is documented by the [insights receipt](verification/insights-proof.json) and the lifecycle, gallery and cleanup receipts below. [Results](verification/results.json) adds a `currentDelivery` section while retaining the earlier root results, dates and provider records unchanged. Byte inventories and source-reading records are maintained separately.

## Current local delivery

The completed local runner passed **204 acceptance cases** and **100 unit tests**, with no failures, skipped, cancelled or flaky cases. Application, server and browser-test TypeScript checks and a production build completed in that runner. Exact case names, durations, log hashes, original screenshots and source hashes are retained in the [current receipt](verification/insights-proof.json). These checks use synthetic local records and controlled loopback providers.

The current application digest is `207429869c5cf98f9093d35b438d41b98196121707d4361a033a86d5a9a40d4e`. Its scope includes present tracked and untracked `app`, `server`, `shared`, package files and Nuxt configuration. Lifecycle receipts are bound to this same digest; their automation-script hashes are checked independently. This working-tree digest has a broader scope than the earlier tracked-only provider digest.

The exercised dashboard behavior includes administrator versus actual course-manager scope, hidden student/TA navigation, direct-request authorization, course aliases, more-than-one-page aggregates, term changes and empty future terms. First-help P90 uses every valid sample. Eastern day/hour buckets cover DST boundaries. A returning helper's contribution follows actual contact intervals instead of the final helper label.

Individual feedback is explicitly tied to the student's ended request and recorded helper; old course feedback is not reassigned to a TA. Duplicate submissions, stale or foreign references and insufficient contact are checked. Ratings show sample count, distinct reviewers and dates. Request cohorts, feedback submission dates, self-reported UTC work dates and current-semester staffing are separate evidence. Approved plans, reservations and effective TA access are distinct; contractual hours exclude unknown manual-role schedules.

The current browser evidence contains **256 page/browser/width accessibility scans**, **230 control-geometry states** and **10 queue-width checks**, all with zero configured violations/issues. The exercised widths are 1440, 768, 390 and 320 pixels in Chromium and Firefox. Four original insights captures are retained under [verification screenshots](verification/screenshots/), each with its source and delivery-copy hash. Automated WCAG/geometry checks do not establish universal accessibility or physical-device behavior.

## Current automatic TA lifecycle

The [headless lifecycle receipt](verification/insights-lifecycle-headless-proof.json) records **2 complete rounds and 68 successful steps**, including **1 baseline restoration** with all six sessions reauthenticated. Its **6 additional accessibility scans** reported no violations.

The [visible Windows receipt](verification/insights-lifecycle-headed-proof.json) records **1 complete round and 34 steps**, with **131 native foreground checks** confirming the intended demonstration window was both foreground and maximized. A headless browser result is not substituted for this native-window evidence.

The same synthetic student applies, receives and accepts an offer, waits for clearance, gains dated TA course access, operates the queue, receives student feedback, reports work, loses TA authority after the appointment ends, and reaches manual financial closeout and archive. A second instructor sees candidate availability change. Department insights reflect the observed support and explicitly attributed feedback. Course closeout is not calendar-semester expiry. [Automatic presentation instructions](AUTOMATED_DEMO.md)

Both finite lifecycle receipts record complete cleanup of their own application, generated database and owned browser resources. The [service-cleanup receipt](verification/insights-service-cleanup.json), recorded at `2026-11-08T01:44:47.688Z`, separately confirms the two named local verification health targets were closed and their owned container was absent. This describes those validation targets at that time; it does not claim that unrelated services or any later interactive preview are closed.

## Current offline presentation

The [offline gallery](demo/index.html) contains **13 original screenshots**: **11 actual workflow captures** and **2 saved real OpenAI panels**. Its [current receipt](verification/insights-gallery-proof.json) binds the current HTML and PNG hashes, with **8 browser-width cases** and **16 page/dialog accessibility scans**. Presentation navigation, original-image viewing, keyboard focus and offline loading are covered by that receipt.

The two real AI panels retain their earlier synthetic evidence and provider-run provenance. They are not new responses for the lifecycle protagonist. The earlier twelve-image pitch receipt is historical; current gallery bytes and counts are established by the thirteen-image receipt. [Project pitch](ROADSHOW.md) and [preparation guide](DEMO_GUIDE.md)

## Retained historical baseline

The root fields in [results.json](verification/results.json), originally recorded at `2026-11-07T21:57:13.890133+00:00`, retain the earlier **198 local acceptance cases**, **64 unit tests**, **36 Linux container browser cases** and their original supporting records. The old container run and its image/source receipts have not been promoted to current-source container validation by this update.

The [earlier real OpenAI browser receipt](verification/ai-browser-proof.json) records **12 advisory tasks/reserved attempts** on its own earlier application digest `21c3704a6da36a05953fe24fbfd25f3784f7bb109d1851aaa865933f7357c8fe`. The [populated provider rehearsal](verification/showcase-provider-proof.json), [earlier bounded provider check](verification/ai-provider-proof.json) and [activity ledger](verification/provider-activity.json) also remain dated historical evidence. Reserved attempts are not confirmed billed usage. Their original provider results, dates, models and counts are unchanged.

The earlier **376 application/container accessibility scans**, **8 real-provider page checks**, and earlier ten/twelve-image gallery checks remain historical observations of those exercised builds and assets. They are not added to the current scan total or described as current real-provider verification. The retained dependency-audit snapshot likewise belongs to its recorded baseline unless separately refreshed.

This current local insights/lifecycle/gallery validation scope made **zero real-provider calls** and did not load the saved provider Key. Controlled synthetic provider and credential checks remain distinct from real OpenAI evidence. [AI workflows](AI_WORKFLOWS.md)

## Evidence and product limits

No institutional SSO, real applicant processing, external payroll, hosted deployment, physical-device testing, production-scale behavior, actual hiring quality, adoption or staffing savings is established here. Self-reported hours are not payroll evidence; queue contact is not total teaching work; missing duty history does not prove attendance or utilization. Conditional position costs do not establish required headcount or authorize automatic staffing cuts.

The [file inventory](verification/application-inventory.json), [reading ledger](review/final-reading-ledger.json), [business review](BUSINESS_REVIEW.md) and [product-readiness assessment](PRODUCT_READINESS.md) provide separate coverage and decision records. Inventory hashes, finite tests and a source review are complementary evidence, not an exhaustive correctness or security proof.
