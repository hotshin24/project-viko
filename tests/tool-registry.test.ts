import { expect, test } from "vitest";
import { TOOL_REGISTRY, getTool } from "../src/lib/tools/registry";

test("registry IDs are unique single route segments and paths resolve to their entries", () => {
  expect(new Set(TOOL_REGISTRY.map((tool) => tool.id)).size).toBe(
    TOOL_REGISTRY.length,
  );
  expect(new Set(TOOL_REGISTRY.map((tool) => tool.path)).size).toBe(
    TOOL_REGISTRY.length,
  );
  for (const tool of TOOL_REGISTRY) {
    expect(tool.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    expect(tool.path).toBe(`/tools/${tool.id}`);
    expect(getTool(tool.id)).toBe(tool);
    expect(tool.inputFormats.length).toBeGreaterThan(0);
    expect(tool.outputFormats.length).toBeGreaterThan(0);
  }
  expect(getTool("toString")).toBeUndefined();
});
test("only available tools have executable workspace loaders", () => {
  expect(
    TOOL_REGISTRY.filter((tool) => tool.status === "available").map(
      (tool) => tool.id,
    ),
  ).toEqual(["subtitle-qa", "subtitle-translator", "subtitle-converter"]);
  for (const tool of TOOL_REGISTRY) {
    if (tool.status === "available")
      expect(tool.loadWorkspace).toBeTypeOf("function");
    else expect(tool).not.toHaveProperty("loadWorkspace");
  }
});
