import { redirect } from "next/navigation";

import { currentPrincipal } from "@/lib/auth";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · DrivenX" };

export default async function LoginPage() {
  // Already signed in — no reason to show the form again.
  if (await currentPrincipal()) redirect("/");

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">DrivenX</div>
          <div className="brand-sub">Fleet Management</div>
        </div>

        <div className="card">
          <div className="card-body">
            <LoginForm />
          </div>
        </div>
      </div>
    </main>
  );
}
