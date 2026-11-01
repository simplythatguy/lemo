// The Vercel function: every /api request (vercel.json) goes to the room API.
import { handle } from "../server/app.ts";

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
