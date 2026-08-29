"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AVATAR_PRESET_IDS, presetUrl } from "@/lib/avatar/presets";
import { resolveAvatar } from "@/lib/avatar/resolve";
import { updateProfileAction } from "../server/actions";
import { avatarSrc } from "./user-avatar";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

type Selection =
  | { kind: "unchanged" }
  | { kind: "preset"; id: string }
  | { kind: "upload"; file: File; previewUrl: string };

export function EditProfileDialog({
  open,
  onOpenChange,
  avatar,
  userId,
  userName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  avatar: string | null;
  userId: string;
  userName: string;
}) {
  const t = useTranslations("profile.edit");
  const { toast } = useToast();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(userName);
  const [selection, setSelection] = useState<Selection>({ kind: "unchanged" });
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const current = resolveAvatar(avatar, userId);
  const currentPresetUrl = current.kind === "preset" ? current.url : null;

  function pickFile(file: File | undefined) {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({ title: t("invalidType"), variant: "destructive" });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({ title: t("tooLarge"), variant: "destructive" });
      return;
    }
    if (selection.kind === "upload") URL.revokeObjectURL(selection.previewUrl);
    setSelection({ kind: "upload", file, previewUrl: URL.createObjectURL(file) });
  }

  function handleSave() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("displayName", displayName);
      if (selection.kind === "preset") {
        formData.set("avatar", `preset:${selection.id}`);
      } else if (selection.kind === "upload") {
        formData.set("avatar", "upload");
        formData.set("file", selection.file);
      } else {
        formData.set("avatar", "keep");
      }
      const result = await updateProfileAction(formData);
      if (!result.ok) {
        toast({ title: t("saveFailed"), variant: "destructive" });
        return;
      }
      toast({ title: t("saved") });
      onOpenChange(false);
      router.refresh();
    });
  }

  const uploadPreview =
    selection.kind === "upload"
      ? selection.previewUrl
      : avatar?.startsWith("upload:")
        ? avatarSrc(avatar, userId)
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-display-name">{t("nameLabel")}</Label>
            <Input
              id="profile-display-name"
              value={displayName}
              maxLength={150}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("avatarLabel")}</Label>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex aspect-square items-center justify-center overflow-hidden rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:bg-muted",
                  selection.kind === "upload" &&
                    "border-solid ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
                aria-label={t("upload")}
                title={t("upload")}
              >
                {uploadPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- blob/object URLs
                  <img
                    src={uploadPreview}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <Upload className="size-4" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_TYPES.join(",")}
                className="hidden"
                onChange={(event) => pickFile(event.target.files?.[0])}
              />
              {AVATAR_PRESET_IDS.map((id) => {
                const url = presetUrl(id);
                const isSelected =
                  selection.kind === "preset"
                    ? selection.id === id
                    : selection.kind === "unchanged" &&
                      (avatar === `preset:${id}` ||
                        (avatar == null && currentPresetUrl === url));
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelection({ kind: "preset", id })}
                    className={cn(
                      "aspect-square overflow-hidden rounded-full border border-border bg-white transition-shadow hover:shadow-md",
                      isSelected &&
                        "ring-2 ring-primary ring-offset-2 ring-offset-background",
                    )}
                    aria-label={id}
                    aria-pressed={isSelected}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- static bundled SVGs */}
                    <img src={url} alt="" loading="lazy" className="size-full" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={isPending || !displayName.trim()}>
            {isPending ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
