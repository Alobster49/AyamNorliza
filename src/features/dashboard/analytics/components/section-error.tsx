import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";

export function SectionError() {
  const t = useTranslations("analytics");
  return (
    <Card>
      <CardContent className="py-6 text-sm text-muted-foreground">
        {t("sectionError")}
      </CardContent>
    </Card>
  );
}
