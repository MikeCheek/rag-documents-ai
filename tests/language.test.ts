import { describe, expect, it } from "vitest";
import { detectLanguage } from "@/lib/rag/language";

describe("detectLanguage", () => {
  it.each([
    ["english", "The mitochondria are the powerhouse of the cell, and they produce most of the energy that is used by it."],
    ["italian", "I mitocondri sono la centrale energetica della cellula e producono la maggior parte dell'energia che viene usata."],
    ["french", "Les mitochondries sont la centrale énergétique de la cellule et elles produisent la plupart de l'énergie qui est utilisée."],
    ["german", "Die Mitochondrien sind das Kraftwerk der Zelle und sie erzeugen den größten Teil der Energie, die von ihr genutzt wird."],
    ["spanish", "Las mitocondrias son la central energética de la célula y producen la mayor parte de la energía que se usa en ella."],
    ["portuguese", "As mitocôndrias são a central energética da célula e produzem a maior parte da energia que é usada por ela, não é?"],
    ["dutch", "De mitochondriën zijn de energiecentrale van de cel en zij maken het grootste deel van de energie die door de cel wordt gebruikt."],
  ])("recognizes %s", (lang, text) => {
    expect(detectLanguage(text)).toBe(lang);
  });

  it.each([
    ["", "empty text"],
    ["12 34 56 78", "numbers only"],
    ["mitochondria ATP glucose", "a bare keyword list"],
  ])("falls back to simple for %j (%s)", (text) => {
    expect(detectLanguage(text)).toBe("simple");
  });
});
