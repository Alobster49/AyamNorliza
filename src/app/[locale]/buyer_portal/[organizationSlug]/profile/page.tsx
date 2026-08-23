"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCart } from "@/features/buyer/components/cart-context";
import { getBuyerProfile, updateBuyerProfile } from "@/features/buyer/server/actions";
import { buyerSignOutAction } from "@/features/buyer-auth/server/auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, LogOut } from "lucide-react";

type ProfilePageProps = {
  params: Promise<{ organizationSlug: string }>;
};

export default function ProfilePage({ params }: ProfilePageProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations("buyer.profile");
  // Root-namespace instance for server-action error keys ("errors.buyer.*"),
  // which are full paths — distinct from `t`, which is scoped to "buyer.profile".
  const tRoot = useTranslations();
  const [organizationSlug, setOrganizationSlug] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [formData, setFormData] = useState({
    displayName: "",
    phone: "",
    address: "",
  });

  useEffect(() => {
    params.then((p) => setOrganizationSlug(p.organizationSlug));
  }, [params]);

  // Fetch profile
  useEffect(() => {
    async function fetchProfile() {
      const result = await getBuyerProfile();

      if (!result.ok) {
        toast({
          title: t("errorTitle"),
          description: t("loadFailedDesc"),
          variant: "destructive",
        });
        router.push(`/buyer_portal/${organizationSlug}/login`);
        return;
      }

      const profile = result.data;
      setFormData({
        displayName: profile.display_name || "",
        phone: profile.phone || "",
        address: profile.address || "",
      });
      setLoading(false);
    }

    if (organizationSlug) {
      fetchProfile();
    }
  }, [organizationSlug, router, toast, t]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const result = await updateBuyerProfile({
      displayName: formData.displayName || undefined,
      phone: formData.phone || undefined,
      address: formData.address || undefined,
    });

    setSaving(false);

    if (!result.ok) {
      toast({
        title: t("errorTitle"),
        // `messageKey` is a dynamic full path (e.g. "errors.buyer.profile.updateFailed");
        // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
        description: result.messageKey ? tRoot(result.messageKey as never) : t("saveFailedDefaultDesc"),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: t("profileSavedTitle"),
      description: t("profileSavedDesc"),
    });
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await buyerSignOutAction();
    router.push(`/buyer_portal/${organizationSlug}/login`);
    router.refresh();
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">{t("title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("cardTitle")}</CardTitle>
          <CardDescription>{t("cardDescription")}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSave}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">{t("displayNameLabel")}</Label>
              <Input
                id="displayName"
                value={formData.displayName}
                onChange={(e) =>
                  setFormData({ ...formData, displayName: e.target.value })
                }
                placeholder={t("displayNamePlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">{t("phoneLabel")}</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
                placeholder={t("phonePlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">{t("addressLabel")}</Label>
              <Textarea
                id="address"
                value={formData.address}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
                placeholder={t("addressPlaceholder")}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">{t("addressHint")}</p>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="mr-2 h-4 w-4" />
              )}
              {t("signOut")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t("saveChanges")}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
