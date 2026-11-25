import { bodyOf, respond } from "@/lib/server";

export async function GET(request: Request) {
  // ?q=dana&status=active&page=2 Anything else in the address is not read.
  const asked = new URL(request.url).searchParams;
  const query = { q: asked.get("q"), status: asked.get("status"), page: asked.get("page") };
  return respond(request, (crm, session) => crm.listCustomers(session, query));
}

export async function POST(request: Request) {
  const body = await bodyOf(request);
  return respond(request, (crm, session) => crm.addCustomer(session, body));
}
