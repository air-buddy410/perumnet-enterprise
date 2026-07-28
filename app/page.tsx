import { HomePage } from "./components/cms-public";
import { getCmsContent } from "@/server/cms";
import { getPublicLanguage } from "@/server/public-language";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [content, language] = await Promise.all([getCmsContent(), getPublicLanguage()]);
  return <HomePage content={content} language={language} />;
}
