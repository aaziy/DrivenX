# Setting up WhatsApp (P3-03)

The code side is ready: the delivery layer (P3-01) takes WhatsApp as one more adapter.
What is missing is an account Meta has approved, a number registered to it, and approved
message templates. None of that can be done from this repository.

**The business phone number is deliberately not written in this file.** It belongs in
`.env` once the adapter exists, not in version control.

## What a "template" is

WhatsApp does not let a business send arbitrary text to someone who has not messaged it
in the last 24 hours. Anything sent outside that window must use a **template**: fixed
wording, with numbered gaps (`{{1}}`, `{{2}}`) for the specifics, that Meta has reviewed
and approved in advance. Every alert DrivenX sends is outside that window, so every alert
needs a template.

Each language is a separate template and is approved separately.

## Steps

1. **Create a Meta Business portfolio in DrivenX's name** at business.facebook.com. Use
   the company's legal name and a company administrator. §20 requires DrivenX to own
   everything, and a portfolio created under a developer's personal account would have to
   be migrated later.
2. **Add the WhatsApp product.** At developers.facebook.com create an app of type
   *Business*, add WhatsApp, and attach it to the portfolio. This creates the WhatsApp
   Business Account (WABA).
3. **Register the number.** It must not be active on the regular WhatsApp app or the
   WhatsApp Business app. If it is, that account has to be deleted first (or the number
   used through Meta's "coexistence" option for the Business app). Meta verifies it by
   SMS or voice call, so the SIM must be in someone's hand.
4. **Set the display name.** Meta reviews it; it should match the company name.
5. **Submit the templates below** in WhatsApp Manager → Message templates → Create.
   Category **Utility**, one per language.
6. **Create a system user and a permanent access token** under Business settings. Do not
   use the temporary token on the app dashboard; it expires in 24 hours. Put the token in
   `.env`, never in chat or a commit.
7. **Business verification** (Business settings → Security Center) is optional to start but
   raises the daily limit. Unverified accounts can message roughly 250 people a day, which
   is far more than DrivenX's staff alerts need.

## Templates to submit first

Four templates, staff-facing, covering the alerts that matter most. Each is submitted in
English and Arabic. Meta's rules to keep in mind: a variable cannot be the first or last
thing in the text, variable values cannot contain line breaks, and a template that is
mostly variables is rejected as too generic.

### drivenx_document_expiry

> DrivenX alert: {{1}} for {{2}} expires on {{3}}. Please arrange renewal before then.

Samples: `Emirates ID` · `Fatima Al Marri` · `20 October 2026`

> تنبيه من درِفن إكس: ينتهي {{1}} الخاص بـ {{2}} بتاريخ {{3}}. يرجى ترتيب التجديد قبل ذلك.

### drivenx_payment_overdue

> DrivenX alert: invoice {{1}} on contract {{2}} is overdue. AED {{3}} was due on {{4}}. Please follow it up.

Samples: `INV-000123` · `CON-00042` · `3,570.00` · `1 October 2026`

> تنبيه من درِفن إكس: الفاتورة {{1}} على العقد {{2}} متأخرة. كان مبلغ {{3}} درهم مستحقاً بتاريخ {{4}}. يرجى المتابعة.

### drivenx_service_due

> DrivenX alert: vehicle {{1}} is due for service on {{2}} or at {{3}} km, whichever comes first. Please book it in.

Samples: `VEH-00012` · `15 November 2026` · `45,000`

> تنبيه من درِفن إكس: حان موعد صيانة المركبة {{1}} في {{2}} أو عند {{3}} كم، أيهما أسبق. يرجى حجز موعد.

### drivenx_insurance_expiry

> DrivenX alert: insurance policy {{1}} for vehicle {{2}} expires on {{3}}. Please arrange renewal.

Samples: `POL-77812` · `VEH-00012` · `30 November 2026`

> تنبيه من درِفن إكس: تنتهي وثيقة التأمين {{1}} للمركبة {{2}} بتاريخ {{3}}. يرجى ترتيب التجديد.

**The Arabic is a draft and needs a fluent reader before submission.** It will be read by
staff, but a template is permanent once approved, and editing one sends it back through
review.

The other three notification types (contract expiry, payment due, supplier payment due)
can follow once these are through. Submitting fewer templates first keeps review simple.

## Messaging customers is a different thing

Everything above is for staff. Sending a payment reminder to a **customer** needs their
opt-in, recorded before the first message, and customer-facing wording. The system does not
record WhatsApp consent yet, so that is a separate piece of work to scope with the client.
