"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { signOutAction } from "@/features/identity-access/server/auth-actions";
import {
  BadgeCheck,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarDays,
  ChevronsUpDown,
  ClipboardList,
  Eye,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Map,
  MapPin,
  Package,
  Route,
  ScrollText,
  Search,
  Settings,
  Square,
  Terminal,
  TrendingUp,
  Truck,
  UserCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { UserAvatar } from "@/features/profile/components/user-avatar";
import { EditProfileDialog } from "@/features/profile/components/edit-profile-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  getDashboardSidebarGroups,
  type DashboardRoute,
} from "./dashboard-shell-model";

type AppSidebarProps = {
  organizationName: string;
  organizationSlug: string;
  organizationRegion: string | null;
  userName: string;
  userEmail: string;
  userId: string;
  userAvatar: string | null;
  grants: string[];
};

// One icon per nav item, keyed by the item's `dashboard` message key. The nav
// is a flat list of links now, so the icon is what identifies a row once the
// sidebar collapses to `collapsible="icon"` — every key in
// dashboard-shell-model.ts's routeGroups needs an entry here.
const pageIcons: Record<string, LucideIcon> = {
  "pages.driverDeck": Truck,
  "pages.dashboard": LayoutDashboard,
  "pages.products": Package,
  "pages.orders": ClipboardList,
  "pages.customers": UserRound,
  "pages.marketPrices": TrendingUp,
  "pages.warehouseTasks": ListChecks,
  "pages.dispatch": Map,
  "pages.loading": Boxes,
  "pages.deliveryRuns": Route,
  "pages.driverRoster": CalendarDays,
  "pages.deliverySetup": MapPin,
  "pages.organization": Building2,
  "pages.users": Users,
  "pages.roles": KeyRound,
  "pages.accessReviews": Eye,
  "pages.auditLog": ScrollText,
  "pages.myLeave": CalendarCheck,
  "pages.leaveManagement": UserCheck,
  "pages.dataConsole": Terminal,
};

type LabelledRoute = DashboardRoute & { label: string };

export function AppSidebar({
  organizationName,
  organizationSlug,
  organizationRegion,
  userName,
  userEmail,
  userId,
  userAvatar,
  grants,
}: AppSidebarProps) {
  const t = useTranslations("dashboard");
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const grantSet = useMemo(() => new Set(grants), [grants]);
  const groups = getDashboardSidebarGroups({ organizationSlug, pathname, grants: grantSet });

  // Labels are resolved once here so the filter matches what the user reads
  // (translated), not the message key.
  const labelled = groups.map((group) => ({
    sectionKey: group.sectionKey,
    label: t(group.sectionKey),
    items: group.items.map<LabelledRoute>((item) => ({ ...item, label: t(item.titleKey) })),
  }));

  const query = search.trim().toLowerCase();
  const visibleGroups = query
    ? labelled
        .map((group) =>
          // A group whose own name matches keeps all its pages; otherwise only
          // the matching pages survive.
          group.label.toLowerCase().includes(query)
            ? group
            : { ...group, items: group.items.filter((item) => item.label.toLowerCase().includes(query)) },
        )
        .filter((group) => group.items.length > 0)
    : labelled;

  return (
    <Sidebar collapsible="icon" variant="inset" className="print:hidden">
      <SidebarHeader>
        <OrganizationSwitcher
          organizationName={organizationName}
          organizationRegion={organizationRegion}
        />
        <div className="relative group-data-[collapsible=icon]:hidden">
          <Label htmlFor="sidebar-search" className="sr-only">
            {t("sidebar.searchLabel")}
          </Label>
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput
            id="sidebar-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("sidebar.searchPlaceholder")}
            className="pl-8"
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.sectionKey} className="py-1">
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const ItemIcon = pageIcons[item.titleKey] ?? Square;

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={item.isActive}
                        tooltip={item.label}
                        className="h-8 rounded-lg data-active:font-medium"
                      >
                        <Link
                          href={item.href}
                          aria-current={item.isActive ? "page" : undefined}
                        >
                          <ItemIcon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        {visibleGroups.length === 0 ? (
          <p className="px-4 py-2 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
            {t("sidebar.searchEmpty")}
          </p>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          organizationSlug={organizationSlug}
          userEmail={userEmail}
          userName={userName}
          userId={userId}
          userAvatar={userAvatar}
        />
      </SidebarFooter>
    </Sidebar>
  );
}

function OrganizationSwitcher({
  organizationName,
  organizationRegion,
}: {
  organizationName: string;
  organizationRegion: string | null;
}) {
  const t = useTranslations("dashboard");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          tooltip={organizationName}
          className="pointer-events-none"
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
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavUser({
  organizationSlug,
  userEmail,
  userName,
  userId,
  userAvatar,
}: {
  organizationSlug: string;
  userEmail: string;
  userName: string;
  userId: string;
  userAvatar: string | null;
}) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const [editProfileOpen, setEditProfileOpen] = useState(false);
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
              <UserAvatar
                avatar={userAvatar}
                userId={userId}
                userName={userName}
                userEmail={userEmail}
                className="h-8 w-8 rounded-lg"
              />
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
                <UserAvatar
                  avatar={userAvatar}
                  userId={userId}
                  userName={userName}
                  userEmail={userEmail}
                  className="h-8 w-8 rounded-lg"
                />
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
              <DropdownMenuItem
                onSelect={() => setEditProfileOpen(true)}
              >
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
        <EditProfileDialog
          open={editProfileOpen}
          onOpenChange={setEditProfileOpen}
          avatar={userAvatar}
          userId={userId}
          userName={userName}
        />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
