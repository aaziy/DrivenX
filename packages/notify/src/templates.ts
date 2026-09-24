/**
 * What a notification says when it arrives somewhere other than the screen (P3-02).
 *
 * The in-app list re-renders each notification from its type and the record it points
 * at, so it reads in whichever language the person has chosen. An email cannot do that:
 * it is written once, sent, and read later, so it has to be rendered in the recipient's
 * language at the moment it goes out.
 *
 * The stored `title` and `body` on the notification are the fallback rather than the
 * source. They are composed in English by the worker that raised them, which is fine for
 * a log and wrong for a message to a person who reads Arabic.
 *
 * Every type appears in both languages, and a test iterates `NOTIFICATION_TYPES` to
 * prove it — a type added without a template would otherwise arrive as a blank subject.
 */

import { NOTIFICATION_TYPES, type NotificationType } from "@drivenx/core";

export type Locale = "en" | "ar";

export interface TemplateInput {
  type: NotificationType;
  locale: Locale;
  /** What the notification itself says, in English, as the worker composed it. */
  title: string;
  body: string;
  /** The day the thing falls due, already formatted for the reader. */
  dueOn?: string | undefined;
  url?: string | undefined;
}

interface Template {
  /** Takes the notification's own English title, so a subject still names the thing. */
  subject: (title: string) => string;
  /** The sentence around the body, which the worker has already made specific. */
  lead: string;
  action: string;
}

const TEMPLATES: Record<Locale, Record<NotificationType, Template>> = {
  en: {
    DOCUMENT_EXPIRY: {
      subject: (title) => `DrivenX: ${title}`,
      lead: "A document on file is running out.",
      action: "Open it in DrivenX",
    },
    INSURANCE_EXPIRY: {
      subject: (title) => `DrivenX: ${title}`,
      lead: "An insurance policy needs renewing.",
      action: "Open the policy in DrivenX",
    },
    PAYMENT_DUE: {
      subject: (title) => `DrivenX: ${title}`,
      lead: "A payment is due.",
      action: "Open the contract in DrivenX",
    },
    PAYMENT_OVERDUE: {
      subject: (title) => `DrivenX: ${title}`,
      lead: "A payment has been missed.",
      action: "Open the contract in DrivenX",
    },
    CONTRACT_EXPIRY: {
      subject: (title) => `DrivenX: ${title}`,
      lead: "A contract is coming to an end.",
      action: "Open the contract in DrivenX",
    },
    MAINTENANCE_DUE: {
      subject: (title) => `DrivenX: ${title}`,
      lead: "A car is due for service.",
      action: "Open the vehicle in DrivenX",
    },
    SUPPLIER_PAYMENT_DUE: {
      subject: (title) => `DrivenX: ${title}`,
      lead: "A supplier is owed.",
      action: "Open the supplier in DrivenX",
    },
  },
  ar: {
    DOCUMENT_EXPIRY: {
      subject: (title) => `درِفن إكس: ${title}`,
      lead: "مستند محفوظ على وشك الانتهاء.",
      action: "افتحه في درِفن إكس",
    },
    INSURANCE_EXPIRY: {
      subject: (title) => `درِفن إكس: ${title}`,
      lead: "وثيقة تأمين بحاجة إلى تجديد.",
      action: "افتح الوثيقة في درِفن إكس",
    },
    PAYMENT_DUE: {
      subject: (title) => `درِفن إكس: ${title}`,
      lead: "هناك دفعة مستحقة.",
      action: "افتح العقد في درِفن إكس",
    },
    PAYMENT_OVERDUE: {
      subject: (title) => `درِفن إكس: ${title}`,
      lead: "فاتت دفعة دون سداد.",
      action: "افتح العقد في درِفن إكس",
    },
    CONTRACT_EXPIRY: {
      subject: (title) => `درِفن إكس: ${title}`,
      lead: "عقد يقترب من نهايته.",
      action: "افتح العقد في درِفن إكس",
    },
    MAINTENANCE_DUE: {
      subject: (title) => `درِفن إكس: ${title}`,
      lead: "سيارة يحين موعد صيانتها.",
      action: "افتح المركبة في درِفن إكس",
    },
    SUPPLIER_PAYMENT_DUE: {
      subject: (title) => `درِفن إكس: ${title}`,
      lead: "مستحقات لمورّد.",
      action: "افتح المورّد في درِفن إكس",
    },
  },
};

export function hasTemplate(locale: Locale, type: NotificationType): boolean {
  return TEMPLATES[locale]?.[type] !== undefined;
}

/** Every type covered in every language — what the catalogue test iterates. */
export function templateCoverage(): Array<{ locale: Locale; type: NotificationType }> {
  const missing: Array<{ locale: Locale; type: NotificationType }> = [];
  for (const locale of ["en", "ar"] as const) {
    for (const type of NOTIFICATION_TYPES) {
      if (!hasTemplate(locale, type)) missing.push({ locale, type });
    }
  }
  return missing;
}

export function renderNotification(input: TemplateInput): { subject: string; text: string } {
  const template = TEMPLATES[input.locale][input.type];

  const lines = [template.lead, "", input.body];
  if (input.dueOn) lines.push("", input.dueOn);
  if (input.url) lines.push("", `${template.action}: ${input.url}`);

  return {
    subject: template.subject(input.title),
    // Plain text, deliberately. An HTML mail needs a plain-text part anyway, and this is
    // an internal alert whose whole content is one sentence and a link.
    text: lines.join("\n"),
  };
}

export interface DigestItem {
  type: NotificationType;
  /** The notification's own English title, as the worker composed it. */
  title: string;
  body: string;
  dueOn?: string | undefined;
  url?: string | undefined;
}

const DIGEST: Record<Locale, { subject: (count: number) => string; lead: string; closing: string }> = {
  en: {
    subject: (count) =>
      count === 1 ? "DrivenX: 1 thing needs attention" : `DrivenX: ${count} things need attention`,
    lead: "These are waiting in DrivenX:",
    closing: "They are also in the notifications list, where marking one read clears it for everyone.",
  },
  ar: {
    subject: (count) =>
      count === 1 ? "درِفن إكس: أمر واحد يحتاج انتباهك" : `درِفن إكس: ${count} أمور تحتاج انتباهك`,
    lead: "هذه بانتظارك في درِفن إكس:",
    closing: "وهي أيضاً في قائمة التنبيهات، وتحديد أحدها كمقروء يزيله عن الجميع.",
  },
};

/**
 * Everything one person is waiting on, as a single message (P3-04).
 *
 * One email per person per run rather than one per alert. A fleet with ten documents
 * expiring in the same week would otherwise send ten separate emails to the same person
 * on the same morning, and the reliable result of that is a filter rule — after which
 * the eleventh, which mattered, is not read either.
 *
 * Each line stays specific. A digest that summarised ten alerts as "you have ten alerts"
 * would force a trip to the screen to learn anything, which is the cost the email was
 * supposed to save.
 */
export function renderDigest(input: {
  locale: Locale;
  items: readonly DigestItem[];
}): { subject: string; text: string } {
  const digest = DIGEST[input.locale];

  const lines: string[] = [digest.lead, ""];
  for (const item of input.items) {
    lines.push(`• ${item.body}`);
    if (item.dueOn) lines.push(`  ${item.dueOn}`);
    if (item.url) lines.push(`  ${item.url}`);
    lines.push("");
  }
  lines.push(digest.closing);

  return { subject: digest.subject(input.items.length), text: lines.join("\n") };
}
