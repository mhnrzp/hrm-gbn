import { parseBody, route } from "@/lib/api";
import { cancelEvent, getEvent, saveEvent } from "@/lib/services/calendar";
import { eventPatchSchema } from "@/lib/validation/calendar";
import { uuid } from "@/lib/validation/common";

export const GET = route<{ id: string }>("member", async ({ db, params }) => getEvent(db, uuid.parse(params.id)));

export const PATCH = route<{ id: string }>("member", async ({ req, db, member, params }) =>
  saveEvent(db, member, await parseBody(req, eventPatchSchema), uuid.parse(params.id)),
);

export const DELETE = route<{ id: string }>("member", async ({ db, params }) => cancelEvent(db, uuid.parse(params.id)));
