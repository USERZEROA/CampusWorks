# CampusWorks video script

Duration: 3 minutes. Actual local browser recording with synthetic data; business scenes do not call AI. Four inserted panels are explicitly labeled saved real OpenAI examples, with earlier provider provenance retained in the project. No desktop or Key window is recorded. Narration uses an offline English Windows voice.

Reproduction prerequisites: Windows with an enabled English System.Speech voice; FFmpeg and ffprobe on PATH with libx264 and AAC support; installed project dependencies and Playwright Chromium; installed Chrome or Edge for the final MP4 playback check. Rendering does not need an API Key.

Generate with `node scripts/submission-video.mjs`. The source lifecycle recording must already exist under `.cache/submission-export/video/`. Optionally use `--demo-url` only after the public HTTPS link is verified. Upload the MP4 to your own YouTube or Vimeo account and paste its URL into the submission form.

Outputs under `.cache/submission-export/`: `CampusWorks-demo-3min.mp4`, `CampusWorks-demo-subtitles.srt`, `video-manifest.json` and `video-contact-sheet.png`. The manifest records source hashes and successful full decoding, audible narration and browser playback. The video crops the presentation-only banner from recorded business scenes; correctly timed role captions appear on the left and product UI pixels retain their original size.

| Time | Scene | Narration |
| --- | --- | --- |
| 00:00–00:08 | From application to student support. | CampusWorks connects assistant applications, appointments, course support, and evidence for the next teaching cycle. |
| 00:08–00:12 | Open the shared recruitment cycle | An administrator opens one shared recruitment cycle for everyone. |
| 00:12–00:16 | Define the course position | The instructor sets course duties and weekly hours. |
| 00:16–00:20 | Set qualifications and publish for approval | Qualifications and screening questions describe the evidence applicants should provide. |
| 00:20–00:24 | Approve the course opening | An administrator approves the opening before students can apply. |
| 00:24–00:32 | Saved OpenAI example: Requirements with evidence | This saved OpenAI example suggests qualification focused wording. It is advice for the instructor, not an automatic edit. |
| 00:32–00:36 | Discover the opportunity | Alex finds the course opening as an ordinary student. |
| 00:36–00:40 | Answer the qualification questions | Academic preparation, availability, and answers stay with the application. |
| 00:40–00:44 | Attach a CV and submit | Alex attaches a synthetic CV and submits the reviewed application. |
| 00:44–00:48 | Apply to another course as well | The same applicant can express interest in another course. |
| 00:48–00:52 | A second instructor reviews the same applicant | A second instructor reviews Alex for a different opening. |
| 00:52–00:56 | Review Alex for CS201 | The reviewer inspects Alex's submitted qualifications and screening answers. |
| 00:56–01:04 | Saved OpenAI example: Preparation and evidence gaps | A saved real response summarizes typed qualifications and missing evidence, with references to the submitted application. |
| 01:04–01:08 | Shortlist and issue the offer | The instructor shortlists Alex and issues an offer. |
| 01:08–01:12 | The other instructor sees availability update | Other instructors now see that Alex is no longer available. |
| 01:12–01:20 | Saved OpenAI example: Current eligible alternatives | After Alex is reserved elsewhere, this recorded response compares eligible alternatives. Its coverage is one candidate page, rather than an overall ranking. |
| 01:20–01:24 | Accept the CS201 offer | Alex accepts the offer. Course access still waits for clearance. |
| 01:24–01:28 | Record the appointment clearance | The administrator records clearance for the accepted appointment. |
| 01:28–01:32 | Alex becomes the appointed course TA | The same account now gains the correct course assistant tools. |
| 01:32–01:36 | Start the office-hours shift | Alex starts duty before operating the live queue. |
| 01:36–01:40 | The existing TA coordinates the session | The team posts an announcement with a labeled Zoom example. |
| 01:40–01:44 | A student enrolls in the course | Sam enrolls in the course before asking for help. |
| 01:44–01:48 | Ask for help through the live queue | Sam adds a question and location to the queue. |
| 01:48–01:52 | Alex claims Sam’s request | Alex claims Sam's request, making the assigned helper visible. |
| 01:52–01:56 | The student sees who is helping | Sam can see which assistant is providing help. |
| 01:56–02:00 | Complete the help session | Alex completes the session, retaining its history. |
| 02:00–02:04 | Give feedback on the support | Sam links feedback to the actual completed session and helper. |
| 02:04–02:08 | Record work beyond queue timing | Alex reports teaching work that happens beyond the queue. |
| 02:08–02:12 | Review course operations and feedback | The instructor reviews observed support and attributed student feedback. |
| 02:12–02:16 | Close the course support queue | The team closes the queue when office hours end. |
| 02:16–02:20 | Return to the TA page before closeout | Alex still has assistant access before the appointment is ended. |
| 02:20–02:24 | End the appointment with a reason | The instructor ends the appointment with a recorded reason. |
| 02:24–02:28 | TA access disappears automatically | Assistant tools disappear. Alex keeps student access. |
| 02:28–02:32 | See the evidence for the next cycle | Course review brings demand, work reports, and staffing evidence together. |
| 02:32–02:40 | Saved OpenAI example: Context for the next cycle | This recorded course advice connects observed demand, reported work, and staffing coverage, while keeping the limits of that evidence visible. |
| 02:40–02:44 | Compare department demand and support | The department compares course demand, coverage, and feedback sample counts. |
| 02:44–02:48 | Archive the completed opening | The instructor archives the completed opening. |
| 02:48–02:52 | One account, a complete lifecycle | Alex keeps application history after the full teaching lifecycle. |
| 02:52–03:00 | Explore the complete journey. | Explore four roles in your own browser. The public experience uses synthetic local data and saved AI examples. Live AI belongs in the full application. |
