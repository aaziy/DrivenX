import { getTranslations } from "next-intl/server";

import { createSupplier } from "./actions";
import { SupplierForm } from "./supplier-form";

export async function CreateSupplierCard() {
  const t = await getTranslations("suppliers");

  return (
    <div className="card">
      <div className="card-header">
        <h2>{t("addTitle")}</h2>
      </div>
      <div className="card-body">
        <SupplierForm action={createSupplier} />
      </div>
    </div>
  );
}
