"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

type ImageUploadProps = {
  organizationId: string;
  value: string | null;
  onChange: (url: string | null) => void;
};

export function ImageUpload({ organizationId, value, onChange }: ImageUploadProps) {
  const t = useTranslations("seller.products.imageUpload");
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError(t("invalidType"));
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(t("tooLarge"));
      return;
    }
    setUploading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${organizationId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md border bg-muted">
          <Image src={value} alt={t("imageAlt")} fill className="object-cover" />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute right-2 top-2 h-7 w-7"
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (uploading) return;
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={`flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed text-muted-foreground transition-colors duration-150 ${
            dragActive
              ? "border-primary bg-accent text-foreground"
              : "bg-muted/50 hover:bg-muted"
          }`}
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <>
              <ImagePlus className="h-6 w-6" />
              <span className="text-sm">{t("uploadPhoto")}</span>
            </>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
