import "server-only";

import { cookies } from "next/headers";

export type PublicLanguage = "id" | "en";

export async function getPublicLanguage(): Promise<PublicLanguage> {
  return (await cookies()).get("perumnet_language")?.value === "en" ? "en" : "id";
}
