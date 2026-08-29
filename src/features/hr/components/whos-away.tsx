"use client";

/**
 * Today / This-week groups of approved absences, from the safe
 * `leave_whos_away` view (name + type + dates only — never justification,
 * attachment, or decision note; see leave-actions.ts), plus the next five
 * upcoming public holidays.
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { addDays, format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatDateRange, formatDisplayDate } from "../lib/date-format";
import type { WhosAwayRow } from "../server/leave-actions";

type WhosAwayProps = {
  whosAway: WhosAwayRow[];
  holidays: { date: string; name: string }[];
  today: string;
};

export function WhosAway({ whosAway, holidays, today }: WhosAwayProps) {
  const t = useTranslations("hr.whosAway");

  const weekEnd = useMemo(() => format(addDays(parseISO(today), 6), "yyyy-MM-dd"), [today]);

  const awayToday = whosAway.filter((r) => r.startDate <= today && today <= r.endDate);
  const awayThisWeek = whosAway.filter((r) => r.startDate <= weekEnd && r.endDate >= today);
  const upcomingHolidays = holidays.filter((h) => h.date >= today).slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-1.5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">{t("today")}</h3>
          {awayToday.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="space-y-1">
              {awayToday.map((r, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium">{r.displayName}</span>{" "}
                  <span className="text-muted-foreground">
                    · {r.typeName} · {formatDateRange(r.startDate, r.endDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Separator />

        <section className="space-y-1.5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">{t("thisWeek")}</h3>
          {awayThisWeek.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="space-y-1">
              {awayThisWeek.map((r, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium">{r.displayName}</span>{" "}
                  <span className="text-muted-foreground">
                    · {r.typeName} · {formatDateRange(r.startDate, r.endDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Separator />

        <section className="space-y-1.5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">{t("holidaysTitle")}</h3>
          {upcomingHolidays.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("holidaysEmpty")}</p>
          ) : (
            <ul className="space-y-1">
              {upcomingHolidays.map((h) => (
                <li key={h.date} className="flex items-center justify-between text-sm">
                  <span>{h.name}</span>
                  <span className="text-muted-foreground">{formatDisplayDate(h.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
