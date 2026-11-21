import { bodyOf, respond } from "@/lib/server";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  const body = await bodyOf(request);
  return respond(request, (crm, session) => crm.updateCustomer(session, id, body));
}

export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  return respond(request, (crm, session) => crm.deleteCustomer(session, id));
}
