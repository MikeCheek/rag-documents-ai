import { describe, expect, it } from "vitest";
import { checkCitations, extractFigures, splitAnswerSentences } from "@/lib/rag/citation-check";

const passages = [
  "Mitochondria produce ATP through oxidative phosphorylation. A typical cell holds 1,000 to 2,000 of them.",
  "The 2023 report found revenue grew 12.5% to 4.2 million euros.",
];

describe("checkCitations", () => {
  it("passes well-supported sentences", () => {
    const check = checkCitations(
      "Mitochondria produce ATP through oxidative phosphorylation [1]. Revenue grew 12.5% in the 2023 report [2].",
      passages
    );
    expect(check).toEqual({ checkedSentences: 2, issues: [] });
  });

  it("flags citations to sources that don't exist", () => {
    const { issues } = checkCitations("Mitochondria produce ATP [3].", passages);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "missing_source", citations: [3] });
    expect(issues[0].detail).toMatch(/only 2 sources/);
  });

  it("flags figures that aren't in the cited source", () => {
    const { issues } = checkCitations("Revenue grew 15% to 4.2 million euros in 2023 [2].", passages);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("numbers_not_found");
    expect(issues[0].detail).toContain("15");
    expect(issues[0].detail).not.toContain("4.2");
  });

  it("accepts figures written with different separators", () => {
    const { issues } = checkCitations("A cell holds between 1000 and 2000 mitochondria [1].", passages);
    expect(issues).toEqual([]);
  });

  it("flags sentences sharing almost no words with their source", () => {
    const { issues } = checkCitations(
      "Photosynthesis converts sunlight into chemical energy inside chloroplasts of plant leaves [1].",
      passages
    );
    expect(issues.map((i) => i.kind)).toEqual(["weak_support"]);
  });

  it("doesn't call a translation unsupported", () => {
    const { issues } = checkCitations(
      "I mitocondri producono ATP attraverso la fosforilazione ossidativa e sono la centrale della cellula [1].",
      passages
    );
    expect(issues).toEqual([]);
  });

  it("handles [1, 2] and [1][2] forms and ignores uncited sentences", () => {
    const check = checkCitations(
      "Intro without citations. Mitochondria produce ATP and revenue grew 12.5% [1, 2]. Also ATP [1][2].",
      passages
    );
    expect(check.checkedSentences).toBe(2);
    expect(check.issues).toEqual([]);
  });
});

describe("helpers", () => {
  it("splits sentences and list items, stripping markdown", () => {
    expect(splitAnswerSentences("**Bold** claim [1]. Next one.\n- item [2]\n1. numbered")).toEqual([
      "Bold claim [1].",
      "Next one.",
      "item [2]",
      "numbered",
    ]);
  });

  it("extracts figures of 2+ digits, normalized", () => {
    expect(extractFigures("In 2023, 3 of 1,250 items (4.5%) cost 7")).toEqual(["2023", "1250", "45"]);
  });
});
