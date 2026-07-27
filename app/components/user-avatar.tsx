"use client";

import { useState } from "react";
import { appPath } from "../paths";

interface UserAvatarProps {
  name: string;
  avatarUrl?: string;
  className?: string;
}

export function UserAvatar({ name, avatarUrl, className = "" }: UserAvatarProps) {
  const [failedUrl, setFailedUrl] = useState("");
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <span className={`avatar avatar-image ${className}`.trim()}>
      {avatarUrl && failedUrl !== avatarUrl ? (
        <img
          src={appPath(avatarUrl)}
          alt={`Foto profil ${name}`}
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
