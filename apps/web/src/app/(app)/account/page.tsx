import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { requireUser } from "@/lib/auth";

import { changePasswordAction } from "./actions";
import { PasswordForm } from "./password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: `${t("title")} · DrivenX` };
}

/** Your own account. Open to everybody who is signed in, whatever their role. */
export default async function AccountPage() {
  const principal = await requireUser();
  const t = await getTranslations("account");

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-subtitle">
            <bdi>{principal.email}</bdi>
          </p>
        </div>
      </header>

      <div className="page-body">
        <section className="card">
          <div className="card-header">
            <h2>{t("passwordTitle")}</h2>
          </div>
          <div className="card-body">
            <p className="field-hint">{t("passwordHint")}</p>
            <PasswordForm action={changePasswordAction} />
          </div>
        </section>
      </div>
    </>
  );
}
