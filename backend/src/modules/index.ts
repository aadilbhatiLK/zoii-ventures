import type { Router } from "../app";
import type { Deps } from "../lib/context";
import { authRoutes } from "./auth/routes";
import { crmRoutes } from "./crm/routes";
import { userRoutes } from "./users/routes";
import { salesRoutes } from "./sales/routes";
import { deliveryRoutes } from "./delivery/routes";
import { financeRoutes } from "./finance/routes";
import { peopleRoutes } from "./people/routes";
import { adminRoutes } from "./admin/routes";

export function registerModules(r: Router, deps: Deps) {
  authRoutes(r, deps);
  userRoutes(r, deps);
  crmRoutes(r, deps);
  salesRoutes(r, deps);
  deliveryRoutes(r, deps);
  financeRoutes(r, deps);
  peopleRoutes(r, deps);
  adminRoutes(r, deps);
}
