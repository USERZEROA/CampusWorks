import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const javascript = ts.transpileModule(
  readFileSync("shared/announcement-links.ts", "utf8").replace(
    /^export\s+/gm,
    "",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  },
).outputText;
const splitAnnouncementLinks = new Function(
  `${javascript}\nreturn splitAnnouncementLinks;`,
)();
const links = (message) =>
  splitAnnouncementLinks(message).filter((part) => part.href);

test("announcement links preserve every text character and the labeled demo URL", () => {
  const message =
    "Online students: Zoom (demo): https://zoom.example.com/j/cs201-office-hours\nBring your question.";
  const parts = splitAnnouncementLinks(message);
  assert.equal(parts.map((part) => part.text).join(""), message);
  assert.deepEqual(links(message), [
    {
      text: "https://zoom.example.com/j/cs201-office-hours",
      href: "https://zoom.example.com/j/cs201-office-hours",
    },
  ]);
});

test("sentence punctuation is excluded while balanced URL parentheses and queries survive", () => {
  const message =
    "See (https://example.com/topic_(one)?room=1&remote=yes), then https://example.com/two].";
  assert.deepEqual(
    links(message).map((part) => part.href),
    [
      "https://example.com/topic_(one)?room=1&remote=yes",
      "https://example.com/two",
    ],
  );
  assert.equal(
    splitAnnouncementLinks(message)
      .map((part) => part.text)
      .join(""),
    message,
  );
  assert.deepEqual(
    links(
      "Join（https://zoom.example.com/j/cs201-office-hours），see 'https://example.com/room'.",
    ).map((part) => part.href),
    [
      "https://zoom.example.com/j/cs201-office-hours",
      "https://example.com/room",
    ],
  );
});

test("unsafe schemes, embedded credentials and URLs inside another scheme remain plain text", () => {
  for (const message of [
    "javascript:alert(1)",
    "data:text/html,<svg/onload=alert(1)>",
    "javascript:https://example.com/path",
    "https://user:password@example.com/private",
    "prefixhttps://example.com",
    "https://",
  ]) {
    assert.deepEqual(links(message), [], message);
    assert.equal(
      splitAnnouncementLinks(message)
        .map((part) => part.text)
        .join(""),
      message,
    );
  }
});

test("HTTP and HTTPS links are recognized without interpreting announcement HTML", () => {
  const message =
    "<img src=x onerror=alert(1)> http://example.com/room <script>alert(1)</script> HTTPS://EXAMPLE.COM/help";
  assert.deepEqual(
    links(message).map((part) => part.href),
    ["http://example.com/room", "https://example.com/help"],
  );
  assert.equal(
    splitAnnouncementLinks(message)
      .map((part) => part.text)
      .join(""),
    message,
  );
  assert.deepEqual(splitAnnouncementLinks(""), [{ text: "" }]);
});
