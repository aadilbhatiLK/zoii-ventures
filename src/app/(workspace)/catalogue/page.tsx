import type { Metadata } from "next";
import { CatalogueView } from "@/features/sales/catalogue-view";

export const metadata: Metadata = { title: "Product Catalogue" };

export default function CataloguePage() {
  return <CatalogueView />;
}
