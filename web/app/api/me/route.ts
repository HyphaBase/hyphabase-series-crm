import { respond } from "@/lib/server";

export async function GET(request: Request) {
  return respond(request, (crm) => crm.me());
}
