"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { getDashboardPageContext } from "./dashboard-shell-model";

type DashboardShellHeaderProps = {
  organizationName: string;
  organizationSlug: string;
};

export function DashboardShellHeader({
  organizationName,
  organizationSlug,
}: DashboardShellHeaderProps) {
  const t = useTranslations("common");
  const pathname = usePathname();
  const context = getDashboardPageContext({ organizationSlug, pathname });

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 print:hidden">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="hidden truncate text-muted-foreground md:inline">
            {organizationName}
          </span>
          <span className="hidden text-muted-foreground md:inline">/</span>
          <span className="truncate font-medium">{context.title}</span>
        </div>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">
          {t("workspaceSuffix", { section: context.section })}
        </p>
      </div>
      <LocaleSwitcher />
      <ThemeToggle />
    </header>
  );
}
