import { route } from "@/lib/api";
import { invoiceSuppliers } from "@/lib/services/invoices";

export const GET = route("manager", async ({ db }) => ({ items: await invoiceSuppliers(db) }));
