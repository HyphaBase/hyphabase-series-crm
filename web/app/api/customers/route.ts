import { bodyOf, respond } from "@/lib/server";

export async function GET(request: Request) {
  return respond(request, (crm, session) => crm.listCustomers(session));
}

export async function POST(request: Request) {
  const body = await bodyOf(request);
  return respond(request, (crm, session) => crm.addCustomer(session, body));
}
