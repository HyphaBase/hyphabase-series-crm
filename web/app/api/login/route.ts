import { bodyOf, respond } from "@/lib/server";

export async function POST(request: Request) {
  const body = await bodyOf(request);
  return respond(request, (crm, session) => crm.signIn(session, body));
}
