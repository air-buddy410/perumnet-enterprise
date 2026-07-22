import { HomePage } from "./components/cms-public";
import { getCmsContent } from "@/server/cms";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <HomePage content={await getCmsContent()} />;
}
