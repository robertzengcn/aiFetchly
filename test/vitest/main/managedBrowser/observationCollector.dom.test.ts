// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, beforeAll } from "vitest";
import {
  COLLECT_ELEMENTS_SCRIPT,
  shapeElementRecord,
  type CollectedElementRecord,
} from "@/childprocess/managed-browser/BrowserObservationService";

/**
 * F08/F14: the REAL collector script executes against a live DOM —
 * visibility-first selection and observed SELECT options.
 */

function rectify(el: Element): void {
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function runCollector(): CollectedElementRecord[] {
  const source = COLLECT_ELEMENTS_SCRIPT;
  // The script is a self-contained IIFE string (template-injected
  // constants already resolved); evaluate it against the live document.
  const evaluate = new Function(`return ${source}`) as () => CollectedElementRecord[];
  return evaluate();
}

beforeAll(() => {
  // happy-dom leaves offsetParent null for every element; emulate the
  // browser contract (no box => null) for the visibility checks.
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    get(this: HTMLElement) {
      if (this instanceof HTMLInputElement && this.type === "hidden") {
        return null;
      }
      return document.body;
    },
    configurable: true,
  });
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("collector visibility-first selection (F08)", () => {
  it("hidden controls before a visible target never crowd it out", () => {
    // 300 hidden inputs, then ONE visible button — the old 2×CAP document
    // order slice could lose the visible target entirely.
    for (let i = 0; i < 300; i++) {
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = `h${i}`;
      document.body.append(hidden);
    }
    const button = document.createElement("button");
    button.textContent = "Submit";
    document.body.append(button);
    rectify(button);

    const records = runCollector();
    const visible = records.filter((r) => r.visible);
    expect(visible.length).toBeGreaterThanOrEqual(1);
    expect(visible.some((r) => r.tag === "button" && r.name === "Submit")).toBe(
      true
    );
    // The visible record's obsId aligns with the stamped subset (the
    // handle pairing contract).
    const submitRecord = visible.find((r) => r.name === "Submit")!;
    expect(Number(submitRecord.obsId)).toBeLessThan(records.length);
  });
});

describe("collector SELECT options (F14)", () => {
  it("collects bounded options with values and labels", () => {
    const select = document.createElement("select");
    select.name = "country";
    for (const [value, label] of [
      ["de", "Germany"],
      ["fr", "France"],
      ["jp", "Japan"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.text = label;
      select.append(option);
    }
    document.body.append(select);
    rectify(select);

    const records = runCollector();
    const selectRecord = records.find((r) => r.tag === "select");
    expect(selectRecord).toBeDefined();
    expect(selectRecord!.options).toHaveLength(3);
    expect(selectRecord!.options!.map((o) => o.v)).toEqual(["de", "fr", "jp"]);
    expect(selectRecord!.options!.map((o) => o.l)).toEqual([
      "Germany",
      "France",
      "Japan",
    ]);
  });

  it("caps the option list at 20", () => {
    const select = document.createElement("select");
    for (let i = 0; i < 30; i++) {
      const option = document.createElement("option");
      option.value = `v${i}`;
      option.text = `Label ${i}`;
      select.append(option);
    }
    document.body.append(select);
    rectify(select);
    const records = runCollector();
    const selectRecord = records.find((r) => r.tag === "select")!;
    expect(selectRecord.options).toHaveLength(20);
  });

  it("shapes options into positional ids plus sanitized labels/values", () => {
    const shaped = shapeElementRecord({
      obsId: "0",
      tag: "select",
      role: "combobox",
      name: "country",
      inputType: null,
      value: "de",
      disabled: false,
      checked: null,
      selected: true,
      hrefOrigin: null,
      visible: true,
      options: [
        { v: "de", l: "Germany" },
        { v: "fr", l: "France" },
      ],
    });
    expect(shaped.option_ids).toEqual(["o_0", "o_1"]);
    expect(shaped.option_labels).toEqual(["Germany", "France"]);
    expect(shaped.option_values).toEqual(["de", "fr"]);
  });
});
