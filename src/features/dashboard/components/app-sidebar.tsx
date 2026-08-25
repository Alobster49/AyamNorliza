"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { signOutAction } from "@/features/identity-access/server/auth-actions";
import {
  BadgeCheck,
  Building2,
  ChevronRight,
  ChevronsUpDown,
  Database,
  LogOut,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserRound,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  getDashboardSidebarGroups,
  getUserInitials,
} from "./dashboard-shell-model";

type AppSidebarProps = {
  organizationName: string;
  organizationSlug: string;
  organizationRegion: string | null;
  userName: string;
  userEmail: string;
  role?: string;
};

const groupIcons: Record<string, LucideIcon> = {
  "Access control": ShieldCheck,
  Fulfillment: Truck,
  Sales: ShoppingCart,
  Warehouse: Warehouse,
  System: Database,
} as const;

export function AppSidebar({
  organizationName,
  organizationSlug,
  organizationRegion,
  userName,
  userEmail,
  role,
}: AppSidebarProps) {
  const t = useTranslations("dashboard");
  const pathname = usePathname();
  const groups = getDashboardSidebarGroups({ organizationSlug, pathname, role });

  return (
    <Sidebar collapsible="icon" variant="inset" className="print:hidden">
      <SidebarHeader>
        <OrganizationSwitcher
          organizationName={organizationName}
          organizationSlug={organizationSlug}
          organizationRegion={organizationRegion}
        />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => {
          const GroupIcon = groupIcons[group.title] ?? Settings;

          return (
            <Collapsible
              key={group.title}
              asChild
              defaultOpen
              className="group/collapsible"
            >
              <SidebarGroup className="py-1">
                <SidebarMenu>
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        isActive={group.isActive}
                        tooltip={t(group.sectionKey)}
                        className="h-9 rounded-lg font-medium"
                      >
                        <GroupIcon />
                        <span>{t(group.sectionKey)}</span>
                        <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                  </SidebarMenuItem>
                </SidebarMenu>
                <CollapsibleContent>
                  <SidebarMenuSub className="mx-4 my-1 gap-1 border-sidebar-border/80 px-3 py-0">
                    {group.items.map((item) => (
                      <SidebarMenuSubItem key={item.href}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={item.isActive}
                          className="h-8 rounded-lg px-3 text-sm data-active:font-medium"
                        >
                          <Link
                            href={item.href}
                            aria-current={item.isActive ? "page" : undefined}
                          >
                            <span>{t(item.titleKey)}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          organizationSlug={organizationSlug}
          userEmail={userEmail}
          userName={userName}
        />
      </SidebarFooter>
    </Sidebar>
  );
}

function OrganizationSwitcher({
  organizationName,
  organizationSlug,
  organizationRegion,
}: {
  organizationName: string;
  organizationSlug: string;
  organizationRegion: string | null;
}) {
  const { isMobile } = useSidebar();
  const t = useTranslations("dashboard");
  const tSettings = useTranslations("settings.organization");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={organizationName}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-white">
                <Image
                  src="/logo-nb-poultry.webp"
                  alt="NB Poultry Processing Industries"
                  width={32}
                  height={32}
                  className="size-full rounded-lg object-contain"
                />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{organizationName}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  {organizationRegion ?? t("sidebar.regionFallback")}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
            className="min-w-56 rounded-lg"
          >
            <DropdownMenuLabel>{t("pages.organization")}</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href={`/${organizationSlug}/settings/organization`}>
                <Building2 />
                {tSettings("title")}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavUser({
  organizationSlug,
  userEmail,
  userName,
}: {
  organizationSlug: string;
  userEmail: string;
  userName: string;
}) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const initials = getUserInitials(userName, userEmail);
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const tSettings = useTranslations("settings.organization");
  const tSecurity = useTranslations("settings.security");

  async function handleSignOut() {
    await signOutAction();
    router.push("/login");
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{userName}</span>
                <span className="truncate text-xs">{userEmail}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
            className="min-w-56 rounded-lg"
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{userName}</span>
                  <span className="truncate text-xs">{userEmail}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href={`/${organizationSlug}/profile/security`}>
                  <BadgeCheck />
                  {tSecurity("title")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/${organizationSlug}/settings/organization`}>
                  <Settings />
                  {tSettings("title")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <UserRound />
                {t("sidebar.operatorProfile")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                void handleSignOut();
              }}
            >
              <LogOut />
              {tCommon("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
