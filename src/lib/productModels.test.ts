import { describe, expect, it } from "vitest";
import { colorGroupsFor, describeColor, shortlistColors, shortlistKey } from "./productColors";
import { shortlistModelSpecs, visualProfileFor } from "./productModels";
import { shortlistProducts } from "./shortlist";
import type { Product } from "./types";

const product = (id: string) => shortlistProducts.find((candidate) => candidate.id === `shortlist-${id}`)!;
const HEX = /^#[0-9a-f]{6}$/i;

describe("shortlist color options", () => {
  it("covers every shortlist product with valid, unique options and a listed default", () => {
    for (const item of shortlistProducts) {
      const groups = colorGroupsFor(item);
      expect(groups.length, item.name).toBeGreaterThan(0);
      for (const group of groups) {
        const names = group.options.map((option) => option.name);
        expect(new Set(names).size, `${item.name} ${group.id}`).toBe(names.length);
        expect(names, `${item.name} default`).toContain(group.defaultName);
        for (const option of group.options) {
          expect(option.hex, `${item.name} ${option.name}`).toMatch(HEX);
          if (option.secondary) expect(option.secondary).toMatch(HEX);
        }
      }
    }
    expect(Object.keys(shortlistColors).sort()).toEqual(shortlistProducts.map((item) => shortlistKey(item.id)).sort());
  });

  it("includes the full retailer option lists", () => {
    const counts = (id: string) => colorGroupsFor(product(id)).map((group) => `${group.id}:${group.options.length}`);
    expect(counts("poang-chair")).toEqual(["cover:12", "frame:4"]);
    expect(counts("kivik-sofa")).toEqual(["color:13"]);
    expect(counts("hobestluk-convertible")).toEqual(["color:31"]);
    expect(counts("big-joe-classic")).toEqual(["color:24"]);
    expect(counts("lagkapten-alex")).toEqual(["color:5"]);
    expect(counts("igloo-32")).toEqual(["color:6"]);
  });
});

describe("individual 3D models", () => {
  it("gives every shortlist product its own renderable model in its listed colors", () => {
    const signatures = new Set<string>();
    for (const item of shortlistProducts) {
      const specs = shortlistModelSpecs[shortlistKey(item.id)];
      expect(specs, item.name).toBeDefined();
      expect(specs.length, item.name).toBeGreaterThanOrEqual(2);
      expect(specs.length, item.name).toBeLessThanOrEqual(24); // renderer draws at most 24 parts
      const profile = visualProfileFor(item)!;
      expect(profile.parts).toHaveLength(specs.length);
      for (const part of profile.parts!) expect(part.colorHex, item.name).toMatch(HEX);
      signatures.add(JSON.stringify(specs));
    }
    expect(signatures.size).toBe(shortlistProducts.length);
  });

  it("recolors the model when a different finish is chosen", () => {
    const markus = product("markus");
    const listed = visualProfileFor(markus)!.parts!.map((part) => part.colorHex);
    const light = visualProfileFor(markus, { color: "Vissle light gray" })!.parts!.map((part) => part.colorHex);
    expect(listed).toContain("#4a4c4f");
    expect(light).toContain("#b9babb");
    expect(light).not.toContain("#4a4c4f");
    expect(light).toContain("#1c1c1c"); // the black base keeps its color
  });

  it("colors POÄNG's cover and frame independently", () => {
    const poang = product("poang-chair");
    const colors = new Set(visualProfileFor(poang, { cover: "Knisa black", frame: "Walnut effect" })!.parts!.map((part) => part.colorHex));
    expect(colors).toEqual(new Set(["#2a2a2a", "#6b4a33"]));
    expect(describeColor(poang, { cover: "Knisa black", frame: "Walnut effect" })).toBe("Knisa black / Walnut effect");
  });

  it("uses the second color of two-tone finishes for legs or drawer units", () => {
    const desk = product("lagkapten-alex");
    const parts = visualProfileFor(desk, { color: "Black-brown/white" })!.parts!;
    expect(parts.find((part) => part.role === "top")!.colorHex).toBe("#3b2f2a");
    expect(parts.filter((part) => part.role === "body").every((part) => part.colorHex === "#f1efe9")).toBe(true);
  });

  it("allows custom colors only on imported products", () => {
    // Shortlist products offer only their retailer colors; a stray custom value falls back to the listed color.
    const listed = visualProfileFor(product("kivik-sofa"))!.parts!.map((part) => part.colorHex);
    expect(visualProfileFor(product("kivik-sofa"), { color: "#123456" })!.parts!.map((part) => part.colorHex)).toEqual(listed);
    expect(describeColor(product("kivik-sofa"), { color: "#123456" })).toBe("Tibbleby beige/gray");

    const imported: Product = { ...product("flintan"), id: "product-imported", visualProfile: undefined, variant: "Oak" };
    expect(visualProfileFor(imported)).toBeUndefined();
    expect(visualProfileFor(imported, { color: "#aa3366" })!.colorHex).toBe("#aa3366");
    expect(describeColor(imported, { color: "#aa3366" })).toBe("Custom #aa3366");
  });

  it("falls back to the listed color for an unknown saved option name", () => {
    const listed = visualProfileFor(product("flintan"))!.parts!.map((part) => part.colorHex);
    expect(visualProfileFor(product("flintan"), { color: "Discontinued teal" })!.parts!.map((part) => part.colorHex)).toEqual(listed);
  });
});
