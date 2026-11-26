// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import { selectOptionsByIdentityFn } from "@/childprocess/managed-browser/BrowserActionExecutor";

/**
 * R02: the REAL identity-commit page function executes against a live
 * DOM — selection applies BY INDEX (duplicate values stay
 * distinguishable), validation and commit are one pass, and a stale
 * expectation throws before any mutation.
 */

function buildSelect(values: string[], multiple = false): HTMLSelectElement {
  const select = document.createElement("select");
  if (multiple) {
    select.multiple = true;
  }
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.text = `label-${value}`;
    select.append(option);
  }
  document.body.append(select);
  return select;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("selectOptionsByIdentityFn (R02/D-FR-17)", () => {
  it("selects BY INDEX so equal-valued options keep their identity", () => {
    const select = buildSelect(["same", "same", "other"]);
    const result = selectOptionsByIdentityFn.call(
      select,
      select,
      ["o_1"],
      ["same"]
    );
    expect(result.ok).toBe(true);
    // Index 1, not the first "same" at index 0.
    expect(select.selectedIndex).toBe(1);
    expect(result.selectedValues).toEqual(["same"]);
  });

  it("a changed live value (stale expectation) throws BEFORE any mutation", () => {
    const select = buildSelect(["de", "fr"]);
    // Browsers auto-select the first option on parse; the stale throw
    // must leave that initial state untouched.
    expect(select.selectedIndex).toBe(0);
    expect(() =>
      selectOptionsByIdentityFn.call(select, select, ["o_0"], ["jp"])
    ).toThrowError("stale_select_option");
    // The page was NOT mutated — still the initial selection.
    expect(select.selectedIndex).toBe(0);
  });

  it("an out-of-range token throws before any mutation", () => {
    const select = buildSelect(["de", "fr"]);
    expect(() =>
      selectOptionsByIdentityFn.call(select, select, ["o_9"], null)
    ).toThrowError("stale_select_option");
    expect(select.selectedIndex).toBe(0);
  });

  it("a multi-select REPLACES the selection with exactly the requested options (R02)", () => {
    const select = buildSelect(["a", "b", "c"], true);
    // Pre-select "a", then commit o_1 and o_2 (b, c) — the REPLACE
    // semantics leave exactly b and c selected.
    select.options[0].selected = true;
    const result = selectOptionsByIdentityFn.call(
      select,
      select,
      ["o_1", "o_2"],
      ["b", "c"]
    );
    expect(result.ok).toBe(true);
    expect(
      Array.from(select.options)
        .filter((o) => o.selected)
        .map((o) => o.value)
    ).toEqual(["b", "c"]);
  });

  it("a DISABLED requested option throws before any mutation (R02)", () => {
    const select = buildSelect(["de", "fr"]);
    select.options[1].disabled = true;
    expect(() =>
      selectOptionsByIdentityFn.call(select, select, ["o_1"], ["fr"])
    ).toThrowError("option_disabled");
    // No mutation happened — still the initial selection.
    expect(select.selectedIndex).toBe(0);
  });

  it("an option inside a DISABLED optgroup throws before any mutation (R02)", () => {
    const select = document.createElement("select");
    const group = document.createElement("optgroup");
    group.disabled = true;
    const option = document.createElement("option");
    option.value = "eu";
    option.text = "Europe";
    group.append(option);
    select.append(group);
    const standalone = document.createElement("option");
    standalone.value = "other";
    select.append(standalone);
    document.body.append(select);
    expect(() =>
      selectOptionsByIdentityFn.call(select, select, ["o_0"], ["eu"])
    ).toThrowError("option_disabled");
    // Browsers skip disabled options for the initial selection — the
    // state is unchanged (still the first ENABLED option).
    expect(select.selectedIndex).toBe(1);
  });

  it("a non-positional value resolves by value and still verifies the expectation", () => {
    const select = buildSelect(["de", "fr"]);
    const result = selectOptionsByIdentityFn.call(
      select,
      select,
      ["fr"],
      ["fr"]
    );
    expect(result.ok).toBe(true);
    expect(select.selectedIndex).toBe(1);
    expect(() =>
      selectOptionsByIdentityFn.call(select, select, ["fr"], ["de"])
    ).toThrowError("stale_select_option");
  });

  it("fires input and change events on commit", () => {
    const select = buildSelect(["de", "fr"]);
    const events: string[] = [];
    select.addEventListener("input", () => events.push("input"));
    select.addEventListener("change", () => events.push("change"));
    selectOptionsByIdentityFn.call(select, select, ["o_1"], ["fr"]);
    expect(events).toEqual(["input", "change"]);
  });
});
