# Project submission materials

[SUBMISSION_FIELDS.md](SUBMISSION_FIELDS.md) contains the title, tagline, 13 technology tags and two public links. Paste [PROJECT_STORY.md](PROJECT_STORY.md) into **About the project**.

## Images

The 15 upload-ready PNGs are in `.cache/submission-export/images/`. Upload the numbered files in order. Each is 1800 × 1200 pixels, uses the requested 3:2 ratio and is below 5 MB. The selection preview is `.cache/submission-export/contact-sheet.png`; original capture hashes are in `.cache/submission-export/images-manifest.json`.

The cards use genuine browser screenshots. Selected sections of long pages are cropped for readability; original PNGs remain unchanged in `docs/demo/screenshots/`. The workflow images follow Avery's prepared CS201 appointment; the saved real OpenAI examples follow Alex's separate local walkthrough. All records are synthetic. Regenerate the cards with `node scripts/submission-images.mjs` after installing project dependencies and Playwright Chromium.

## Video

The finished video is `.cache/submission-export/CampusWorks-demo-3min.mp4`: **180 seconds, 1920 × 1080, 25 fps, H.264/AAC, English narration**, approximately 18.7 MB. It shows all 33 recorded lifecycle steps and four explicitly labeled saved real OpenAI examples. English subtitles are in `.cache/submission-export/CampusWorks-demo-subtitles.srt`.

Upload the MP4 to your own YouTube or Vimeo account, add the SRT as English captions, then paste the share URL into **Video demo link**. Check playback and sound after upload. A local file path does not work in that field. No external video upload has been made on your behalf.

The review preview is `.cache/submission-export/video-contact-sheet.png`; source hashes and successful decoding, audio and browser playback checks are in `.cache/submission-export/video-manifest.json`. [VIDEO_SCRIPT.md](VIDEO_SCRIPT.md) contains the timed transcript and reproduction prerequisites.

## Public experience and live AI

The published experience is https://userzeroa.github.io/campusworks-demo/; its public repository is https://github.com/USERZEROA/campusworks-demo. Each visitor works with synthetic data stored in their own browser. The GitHub experience uses saved AI examples and needs no Key.

For fresh OpenAI responses in the complete local application, use [API_AND_HOSTING.md](API_AND_HOSTING.md). Private Keys stay in local or server-side configuration, outside public Pages assets.
