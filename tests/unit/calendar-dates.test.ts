import { describe, expect, it } from "vitest";
import { addDays, jalaliMonth, shiftJalaliMonth, weekDays } from "@/lib/calendar-dates";
import { formatDate } from "@/lib/format";

describe("calendar dates", () => {
  it("week starts on Saturday", () => {
    const days = weekDays("2026-10-21"); // Wednesday 29 Mehr 1405
    expect(days[0]).toBe("2026-10-17"); // شنبه ۲۵ مهر
    expect(days[6]).toBe("2026-10-23"); // جمعه ۱ آبان
  });

  it("Jalali month bounds and grid for Mehr 1405", () => {
    const m = jalaliMonth("2026-10-17");
    expect(formatDate(m.first, "UTC")).toBe("۱ مهر ۱۴۰۵");
    expect(formatDate(m.last, "UTC")).toBe("۳۰ مهر ۱۴۰۵");
    expect(m.days.length % 7).toBe(0);
    expect(m.days[0] <= m.first && m.days.at(-1)! >= m.last).toBe(true);
    // Figma grid starts on ۲۸ شهریور (Saturday).
    expect(formatDate(m.days[0], "UTC")).toBe("۲۸ شهریور ۱۴۰۵");
  });

  it("month navigation keeps Jalali months", () => {
    expect(formatDate(shiftJalaliMonth("2026-10-17", 1), "UTC")).toBe("۲۵ آبان ۱۴۰۵");
    expect(formatDate(shiftJalaliMonth("2026-10-17", -7), "UTC")).toBe("۲۵ اسفند ۱۴۰۴");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
