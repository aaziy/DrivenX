import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/language-switcher";
import { currentLocale } from "@/i18n/locale";
import { currentPrincipal } from "@/lib/auth";

import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return { title: `${t("title")} · DrivenX` };
}

export default async function LoginPage() {
  // Already signed in — no reason to show the form again.
  if (await currentPrincipal()) redirect("/");

  const [t, locale] = await Promise.all([getTranslations("common"), currentLocale()]);

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">DrivenX</div>
          <div className="brand-sub">{t("brandSubLogin")}</div>
        </div>

        <div className="card">
          <div className="card-body">
            <LoginForm />
          </div>
        </div>

        {/* Offered before sign-in as well, so nobody has to read a language they cannot. */}
        <div className="login-language">
          <LanguageSwitcher current={locale} />
        </div>
      </div>
    </main>
  );
}
