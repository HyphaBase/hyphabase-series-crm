import { respond } from "@/lib/server";

export async function POST(request: Request) {
  return respond(request, (crm) => crm.signOut());
}
