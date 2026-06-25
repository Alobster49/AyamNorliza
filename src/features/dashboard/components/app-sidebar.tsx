"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOutAction } from "@/features/identity-access/server/auth-actions";
import {
  BadgeCheck,
  Bell,
  Building2,
  ChevronRight,
  ChevronsUpDown,
  ClipboardCheck,
  FileClock,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  getDashboardSidebarGroups,
  getUserInitials,
  type DashboardRoute,
} from "./dashboard-shell-model";

type AppSidebarProps = {
  organizationName: string;
  organizationSlug: string;
  organizationRegion: string | null;
  userName: string;
  userEmail: string;
};

const routeIcons: Record<string, LucideIcon> = {
  Overview: LayoutDashboard,
  Alerts: Bell,
  Organization: Building2,
  Users,
  Roles: ShieldCheck,
  "Access reviews": ClipboardCheck,
  "Support sessions": LifeBuoy,
  "Audit log": FileClock,
};

const groupIcons: Record<string, LucideIcon> = {
  Operations: LayoutDashboard,
  "Access control": ShieldCheck,
};

export function AppSidebar({
  organizationName,
  organizationSlug,
  organizationRegion,
  userName,
  userEmail,
}: AppSidebarProps) {
  const pathname = usePathname();
  const groups = getDashboardSidebarGroups({ organizationSlug, pathname });

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <OrganizationSwitcher
          organizationName={organizationName}
          organizationSlug={organizationSlug}
          organizationRegion={organizationRegion}
        />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => {
          const GroupIcon = groupIcons[group.title] ?? LayoutDashboard;

          return (
            <Collapsible
              key={group.title}
              asChild
              defaultOpen
              className="group/collapsible"
            >
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger>
                    <GroupIcon />
                    <span>{group.title}</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={item.isActive}
                          tooltip={item.title}
                        >
                          <Link
                            href={item.href}
                            aria-current={item.isActive ? "page" : undefined}
                          >
                            <RouteIcon route={item} />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
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
      <SidebarRail />
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
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Building2 className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{organizationName}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  {organizationRegion ?? "Operations workspace"}
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
            <DropdownMenuLabel>Organization</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href={`/${organizationSlug}/settings/organization`}>
                <Building2 />
                Organization settings
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function RouteIcon({ route }: { route: DashboardRoute }) {
  const Icon = routeIcons[route.title] ?? LayoutDashboard;
  return <Icon />;
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
                  My security
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/${organizationSlug}/settings/organization`}>
                  <Settings />
                  Organization settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <UserRound />
                Operator profile
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
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
