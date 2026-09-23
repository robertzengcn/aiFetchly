import { describe, expect, it } from "vitest";
import { buildEmailServiceCsvTemplate } from "@/views/utils/emailServiceImportTemplate";

describe("buildEmailServiceCsvTemplate", () => {
  it("returns the 9-column header plus one example row with a password placeholder", () => {
    const csv = buildEmailServiceCsvTemplate();
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe(
      "name,smtpUsername,from,replyTo,host,port,password,ssl,receiveProtocol"
    );
    const cells = lines[1].split(",");
    expect(cells.length).toBe(9);
    // password column (index 6) must be present as a fill-in placeholder
    expect(cells[6].length).toBeGreaterThan(0);
  });
});
