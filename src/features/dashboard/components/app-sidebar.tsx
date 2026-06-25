"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Building2,
  ClipboardCheck,
  FileClock,
  LayoutDashboard,
  LifeBuoy,
  LockKeyhole,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";

type AppSidebarProps = {
  organizationName: string;
  organizationSlug: string;
};

const mainNav = [
  { title: "Overview", segment: "overview", icon: LayoutDashboard },
  { title: "Alerts", segment: "alerts", icon: Bell },
];

const settingsNav = [
  { title: "Organization", segment: "settings/organization", icon: Building2 },
  { title: "Users", segment: "settings/users", icon: Users },
  { title: "Roles", segment: "settings/roles", icon: ShieldCheck },
  { title: "Access reviews", segment: "settings/access-reviews", icon: ClipboardCheck },
  { title: "Support sessions", segment: "settings/support-sessions", icon: LifeBuoy },
  { title: "Audit log", segment: "settings/audit-log", icon: FileClock },
];

export function AppSidebar({
  organizationName,
  organizationSlug,
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              tooltip={organizationName}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Link href={`/${organizationSlug}/overview`}>
                <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                  AN
                </span>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{organizationName}</span>
                  <span className="truncate text-xs text-sidebar-foreground/70">
                    Bertag Norliza
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.segment}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(pathname, organizationSlug, item.segment)}
                    tooltip={item.title}
                  >
                    <Link href={`/${organizationSlug}/${item.segment}`}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>Access control</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsNav.map((item) => (
                <SidebarMenuItem key={item.segment}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(pathname, organizationSlug, item.segment)}
                    tooltip={item.title}
                  >
                    <Link href={`/${organizationSlug}/${item.segment}`}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive(pathname, organizationSlug, "profile/security")}
              tooltip="My security"
            >
              <Link href={`/${organizationSlug}/profile/security`}>
                <LockKeyhole />
                <span>My security</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Settings">
              <Link href={`/${organizationSlug}/settings/organization`}>
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function isActive(pathname: string, organizationSlug: string, segment: string): boolean {
  const href = `/${organizationSlug}/${segment}`;
  return pathname === href || pathname.startsWith(`${href}/`);
}
