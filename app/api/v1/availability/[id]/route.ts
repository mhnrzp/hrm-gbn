import { parseBody, route } from "@/lib/api";
import { deleteAvailability, saveAvailability } from "@/lib/services/calendar";
import { availabilityPatchSchema } from "@/lib/validation/calendar";
import { uuid } from "@/lib/validation/common";

export const PATCH = route<{ id: string }>("member", async ({ req, db, member, params }) =>
  saveAvailability(db, member, await parseBody(req, availabilityPatchSchema), uuid.parse(params.id)),
);

export const DELETE = route<{ id: string }>("member", async ({ db, params }) => deleteAvailability(db, uuid.parse(params.id)));
