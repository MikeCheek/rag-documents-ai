import { describe, expect, it } from "vitest";
import { formatNumber, niceTicks, parseChartSpec } from "@/lib/rich/chart-spec";

describe("parseChartSpec", () => {
  it("accepts a valid bar chart", () => {
    const r = parseChartSpec('{"type":"bar","title":"Revenue","unit":"€M","x":["2022","2023"],"series":[{"name":"Rev","values":[3.1,null]}]}');
    expect(r).toEqual({
      spec: { type: "bar", title: "Revenue", unit: "€M", x: ["2022", "2023"], series: [{ name: "Rev", values: [3.1, null] }] },
    });
  });

  it("accepts stats tiles", () => {
    const r = parseChartSpec('{"type":"stats","items":[{"label":"Revenue","value":4.2,"detail":"+12%"}]}');
    expect(r).toEqual({ spec: { type: "stats", items: [{ label: "Revenue", value: "4.2", detail: "+12%" }] } });
  });

  it.each([
    ["not json", /valid JSON/],
    ['{"type":"pie","x":["a"],"series":[{"values":[1]}]}', /Unknown chart type/],
    ['{"type":"bar","x":["a","b"],"series":[{"values":[1]}]}', /one value per x label/],
    ['{"type":"bar","x":["a"],"series":[{"values":["1"]}]}', /isn't a number/],
    ['{"type":"line","x":["a"],"series":[]}', /at least one series/],
    [JSON.stringify({ type: "bar", x: ["a"], series: Array.from({ length: 9 }, () => ({ values: [1] })) }), /Too many series/],
    ['{"type":"stats","items":[{"label":"x"}]}', /label and a value/],
  ])("rejects %s", (input, error) => {
    const r = parseChartSpec(input);
    expect("error" in r && r.error).toMatch(error);
  });
});

describe("axis helpers", () => {
  it("makes nice ticks from zero", () => {
    expect(niceTicks(0, 4.2)).toEqual([0, 2, 4, 6]);
    expect(niceTicks(3, 97)).toEqual([0, 25, 50, 75, 100]);
    // With negatives: covers the range, includes zero, evenly spaced.
    const t = niceTicks(-30, 70);
    expect(t[0]).toBeLessThanOrEqual(-30);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(70);
    expect(t).toContain(0);
    expect(new Set(t.slice(1).map((v, i) => v - t[i])).size).toBe(1);
  });

  it("formats compactly", () => {
    expect(formatNumber(1234567)).toBe("1.2M");
    expect(formatNumber(12500, "€")).toBe("12.5k €");
    expect(formatNumber(3.14159)).toBe("3.14");
  });
});
