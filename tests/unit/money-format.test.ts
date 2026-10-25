import { describe, expect, it } from "vitest";
import { irrToTomanString, tomanToIrr } from "@/lib/money";
import {
  formatDate,
  formatDateWithWeekday,
  formatDayMonth,
  formatStamp,
  formatTime,
  formatToman,
  initials,
  localIsoDate,
  normalizeAmountInput,
} from "@/lib/format";

const TZ = "Asia/Tehran";

describe("money (spec §8.7)", () => {
  it("round-trips ۱۲٬۵۰۰٬۰۰۰ تومان exactly", () => {
    const irr = tomanToIrr(normalizeAmountInput("۱۲٬۵۰۰٬۰۰۰"));
    expect(irr).toBe(BigInt("125000000"));
    expect(irrToTomanString(irr)).toBe("12500000");
    expect(formatToman(irr)).toBe("۱۲٬۵۰۰٬۰۰۰ تومان");
  });

  it("stays exact beyond Number.MAX_SAFE_INTEGER", () => {
    const irr = tomanToIrr("9007199254740993");
    expect(irr.toString()).toBe("90071992547409930");
    expect(irrToTomanString(irr)).toBe("9007199254740993");
  });

  it("rejects negatives, decimals and junk", () => {
    expect(() => tomanToIrr("-5")).toThrow();
    expect(() => tomanToIrr("12.5")).toThrow();
    expect(() => tomanToIrr("12a")).toThrow();
    expect(() => tomanToIrr("")).toThrow();
  });
});

describe("Jalali display", () => {
  it("formats 2026-10-17 as ۲۵ مهر ۱۴۰۵ (Saturday)", () => {
    expect(formatDate("2026-10-17", TZ)).toBe("۲۵ مهر ۱۴۰۵");
    expect(formatDateWithWeekday("2026-10-17", TZ)).toBe("شنبه، ۲۵ مهر ۱۴۰۵");
    expect(formatDayMonth("2026-10-23", TZ)).toBe("۱ آبان");
  });

  it("CAL-01: an instant late on the Gregorian day lands on the next Tehran day", () => {
    // 21:00 UTC on 16 Oct = 00:30 on 17 Oct in Tehran (UTC+03:30)
    const instant = "2026-10-16T21:00:00Z";
    expect(localIsoDate(new Date(instant), TZ)).toBe("2026-10-17");
    expect(formatDate(instant, TZ)).toBe("۲۵ مهر ۱۴۰۵");
    expect(formatTime(instant, TZ)).toBe("۰۰:۳۰");
  });

  it("date-only values never shift with the zone", () => {
    expect(formatDate("2026-10-17", "Pacific/Kiritimati")).toBe("۲۵ مهر ۱۴۰۵");
    expect(formatDate("2026-10-17", "Pacific/Pago_Pago")).toBe("۲۵ مهر ۱۴۰۵");
  });

  it("stamps today vs. other days", () => {
    const now = new Date("2026-10-17T10:00:00Z");
    expect(formatStamp("2026-10-17T06:00:00Z", TZ, now)).toBe("امروز، ۰۹:۳۰");
    expect(formatStamp("2026-10-14T12:50:00Z", TZ, now)).toBe("۲۲ مهر، ۱۶:۲۰");
  });

  it("builds Figma-style initials", () => {
    expect(initials("سارا محمدی")).toBe("س‌م");
    expect(initials("علی")).toBe("ع");
  });
});
