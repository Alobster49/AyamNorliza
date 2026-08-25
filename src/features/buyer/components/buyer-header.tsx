"use client";

import Image from "next/image";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ShoppingCart,
  User,
  LogOut,
  Package,
  Menu,
  X,
} from "lucide-react";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buyerSignOutAction } from "@/features/buyer-auth/server/auth-actions";
import { useCart } from "./cart-context";
import { useCartUi } from "./cart-ui-context";

type BuyerHeaderProps = {
  organizationSlug: string;
  buyerName?: string;
  isLoggedIn?: boolean;
};

export function BuyerHeader({
  organizationSlug,
  buyerName,
  isLoggedIn = false,
}: BuyerHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { items } = useCart();
  const { openCart } = useCartUi();
  const t = useTranslations("buyer.header");
  const tNav = useTranslations("buyer.nav");
  const tCommon = useTranslations("common");

  const navItems = isLoggedIn
    ? [
        { href: `/buyer_portal/${organizationSlug}/orders`, label: tNav("orders"), icon: Package },
        {
          href: `/buyer_portal/${organizationSlug}/profile`,
          label: tNav("profile"),
          icon: User,
        },
      ]
    : [];

  async function handleSignOut() {
    await buyerSignOutAction();
    router.push(`/buyer_portal/${organizationSlug}/login`);
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background">
      <div className="flex h-16 w-full items-center justify-between px-4">
        {/* Logo */}
        <Link href={`/buyer_portal/${organizationSlug}/shop`} className="flex items-center">
          <Image
            src="/logo-nb-poultry.webp"
            alt={t("brand")}
            width={36}
            height={36}
            className="h-9 w-9 rounded-lg object-contain"
          />
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden items-center gap-6 md:flex">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm font-medium transition-colors hover:text-primary ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right side actions */}
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />

          {/* Cart button - always visible */}
          <Button variant="ghost" size="icon" onClick={openCart} className="relative">
            <ShoppingCart className="h-5 w-5" />
            {items.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-buyer-mono text-[10px] font-medium text-primary-foreground">
                {items.length}
              </span>
            )}
            <span className="sr-only">{t("cart")}</span>
          </Button>

          {isLoggedIn ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <User className="h-5 w-5" />
                  <span className="sr-only">{t("userMenu")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{buyerName || t("buyerFallback")}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={`/buyer_portal/${organizationSlug}/orders`}>
                    <Package className="mr-2 h-4 w-4" />
                    {t("myOrders")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/buyer_portal/${organizationSlug}/profile`}>
                    <User className="mr-2 h-4 w-4" />
                    {tNav("profile")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {tCommon("signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild variant="default" size="sm">
              <Link href={`/buyer_portal/${organizationSlug}/login`}>{t("login")}</Link>
            </Button>
          )}

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
            <span className="sr-only">{t("menuToggle")}</span>
          </Button>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="border-t md:hidden">
          <nav className="container mx-auto px-4 py-3">
            <div className="flex flex-col space-y-2">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
