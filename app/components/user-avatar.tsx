"use client";

import { appPath } from "../paths";

interface UserAvatarProps {
  name: string;
  avatarUrl?: string;
  className?: string;
}

export function UserAvatar({ name, avatarUrl, className = "" }: UserAvatarProps) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <span className={`avatar avatar-image ${className}`.trim()}>
      {avatarUrl ? <img src={appPath(avatarUrl)} alt={`Foto profil ${name}`} /> : initials}
    </span>
  );
}
