import { respond } from "@/lib/server";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return respond(request, (crm, session) => crm.deleteCustomer(session, id));
}
