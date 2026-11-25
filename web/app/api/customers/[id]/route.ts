import { bodyOf, respond } from "@/lib/server";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  const body = await bodyOf(request);
  return respond(request, (crm) => crm.updateCustomer(id, body));
}

export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  return respond(request, (crm) => crm.deleteCustomer(id));
}
