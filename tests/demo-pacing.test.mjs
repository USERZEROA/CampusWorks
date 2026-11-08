import test from "node:test";
import assert from "node:assert/strict";
import { createDemoPacing } from "../scripts/demo-pacing.mjs";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("normal live and deterministic cycles allocate five minutes across their actual steps", () => {
  for (const [withAi, count] of [[true, 38], [false, 33]]) {
    const plan = createDemoPacing({ withAi });
    assert.equal(plan.steps.length, count);
    assert.equal(plan.targetMs, 300000);
    assert.equal(plan.steps.reduce((sum, step) => sum + step.durationMs, 0), 300000);
    assert.ok(plan.steps.every((step) => step.durationMs > 0));
    assert.ok(plan.steps.at(-1).durationMs < 10000);
  }
});

test("AI and information-dense results have reading floors instead of transition-speed holds", () => {
  const plan = createDemoPacing();
  const ai = plan.steps.filter((step) => ["ai", "comparison", "course-ai"].includes(step.category));
  assert.equal(ai.length, 5);
  assert.ok(ai.every((step) => step.durationMs >= 22000 && step.minViewMs >= 15000));
  const peer = ai.find((step) => step.actor === "peer");
  assert.ok(peer.durationMs >= 27000 && peer.minViewMs >= 18000);
  assert.equal(plan.steps.find((step) => step.category === "department").minViewMs, 12000);
  assert.equal(plan.steps.find((step) => step.category === "application").minViewMs, 7000);
});

test("detailed pacing allocates eight minutes while fast verification avoids presentation waits", () => {
  const detailed = createDemoPacing({ pace: "detailed" });
  assert.equal(detailed.steps.reduce((sum, step) => sum + step.durationMs, 0), 480000);
  const fast = createDemoPacing({ pace: "fast" });
  assert.equal(fast.targetMs, 0);
  assert.ok(fast.steps.every((step) => step.holdMs === 150 && step.minViewMs === 0 && step.durationMs === undefined));
});

test("a changed workflow cannot silently receive another step's presentation timing", () => {
  const plan = createDemoPacing();
  assert.equal(plan.forStep({ index: 1, title: "Open the shared recruitment cycle", actor: "admin" }).durationMs, plan.steps[0].durationMs);
  for (const change of [
    { index: 0, title: "Open the shared recruitment cycle", actor: "admin" },
    { index: 1, title: "Changed workflow", actor: "admin" },
    { index: 1, title: "Open the shared recruitment cycle", actor: "applicant" },
  ]) assert.throws(() => plan.forStep(change), /timing plan differ/);
  assert.throws(() => createDemoPacing({ pace: "unexpected" }), /pacing/);
});

test("the timing plan covers every actual lifecycle scene in playback order", () => {
  const source = ts.createSourceFile("demo-loop-flow.mjs", readFileSync("scripts/demo-loop-flow.mjs", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const flow = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "runLoopCycle");
  assert.ok(flow?.body);
  const scenes = [];
  for (const node of flow.body.statements) {
    if (!ts.isExpressionStatement(node) || !ts.isAwaitExpression(node.expression)) continue;
    const call = node.expression.expression;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
    if (call.expression.text === "step") {
      assert.ok(ts.isStringLiteral(call.arguments[0]) && ts.isStringLiteral(call.arguments[1]));
      scenes.push({ actor: call.arguments[0].text, title: call.arguments[1].text, ai: false });
    } else if (call.expression.text === "presentAi") {
      const fields = new Map(call.arguments[0].properties.filter(ts.isPropertyAssignment).map((field) => [field.name.getText(source), field.initializer]));
      scenes.push({ actor: fields.get("actor")?.text || "instructor", title: fields.get("title")?.text, ai: true });
    }
  }
  assert.equal(scenes.length, 38);
  for (const withAi of [true, false]) {
    const actual = scenes.filter((scene) => withAi || !scene.ai);
    const planned = createDemoPacing({ withAi });
    assert.equal(actual.length, planned.steps.length);
    for (const [offset, scene] of actual.entries()) assert.doesNotThrow(() => planned.forStep({ index: offset + 1, ...scene }));
  }
});
