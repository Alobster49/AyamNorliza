"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { resolveAvatar } from "@/lib/avatar/resolve";
import { publicEnv } from "@/lib/env.public";
import { getUserInitials } from "@/features/dashboard/components/dashboard-shell-model";

export function avatarSrc(avatar: string | null | undefined, userId: string): string {
  const resolved = resolveAvatar(avatar, userId);
  if (resolved.kind === "preset") return resolved.url;
  return `${publicEnv().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${resolved.path}`;
}

export function UserAvatar({
  avatar,
  userId,
  userName,
  userEmail,
  className,
}: {
  avatar: string | null | undefined;
  userId: string;
  userName: string;
  userEmail: string;
  className?: string;
}) {
  return (
    <Avatar className={className}>
      <AvatarImage src={avatarSrc(avatar, userId)} alt={userName} />
      <AvatarFallback className="rounded-lg">
        {getUserInitials(userName, userEmail)}
      </AvatarFallback>
    </Avatar>
  );
}
