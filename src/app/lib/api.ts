import { createClient } from "@fcalell/plugin-api/client";
import type { AppRouter } from "../../../.stack/worker.ts";

export const api = createClient<AppRouter>();
