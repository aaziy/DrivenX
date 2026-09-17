import { getTranslations } from "next-intl/server";

import { createCustomer } from "./actions";
import { CustomerForm } from "./customer-form";

/** Matches the Users page: the add form sits above the list, in a plain card. */
export async function CreateCustomerCard() {
  const t = await getTranslations("customers");

  return (
    <div className="card">
      <div className="card-header">
        <h2>{t("addTitle")}</h2>
      </div>
      <div className="card-body">
        <CustomerForm action={createCustomer} />
      </div>
    </div>
  );
}
