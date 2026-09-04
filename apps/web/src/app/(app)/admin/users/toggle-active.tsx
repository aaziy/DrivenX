"use client";

import { SubmitButton } from "@/components/form";

import { setUserActive } from "./actions";

export function ToggleActive({ userId, isActive }: { userId: string; isActive: boolean }) {
  return (
    <form action={setUserActive.bind(null, userId, !isActive)}>
      <SubmitButton variant="secondary" pendingLabel="Saving…">
        {isActive ? "Deactivate" : "Reactivate"}
      </SubmitButton>
    </form>
  );
}
