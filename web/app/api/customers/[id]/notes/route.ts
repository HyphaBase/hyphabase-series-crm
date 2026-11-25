import { bodyOf, respond } from "@/lib/server";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  return respond(request, (crm, session) => crm.listNotes(session, id));
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const body = await bodyOf(request);
  return respond(request, (crm, session) => crm.addNote(session, id, body));
}
