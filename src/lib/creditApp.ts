/** Standard freight-broker customer credit application: fields + terms text. */
export type CreditField = { key: string; label: string; required?: boolean; type?: "text" | "email" | "tel" | "number" | "select"; options?: string[]; wide?: boolean };
export type CreditSection = { title: string; fields: CreditField[] };

const ref = (n: number): CreditSection => ({
  title: `Trade reference ${n}`,
  fields: [
    { key: `ref${n}_company`, label: "Company", required: n <= 2 },
    { key: `ref${n}_contact`, label: "Contact name" },
    { key: `ref${n}_phone`, label: "Phone", type: "tel", required: n <= 2 },
    { key: `ref${n}_email`, label: "Email", type: "email" },
  ],
});

export const CREDIT_SECTIONS: CreditSection[] = [
  { title: "Company information", fields: [
    { key: "legal_name", label: "Legal business name", required: true, wide: true },
    { key: "dba", label: "DBA (if any)" },
    { key: "entity_type", label: "Business type", type: "select", options: ["Corporation", "LLC", "Partnership", "Sole proprietor", "Other"], required: true },
    { key: "address", label: "Billing address", required: true, wide: true },
    { key: "city", label: "City", required: true },
    { key: "state", label: "State", required: true },
    { key: "zip", label: "ZIP", required: true },
    { key: "phone", label: "Main phone", type: "tel", required: true },
    { key: "website", label: "Website" },
    { key: "ein", label: "Federal tax ID (EIN)", required: true },
    { key: "duns", label: "D-U-N-S number" },
    { key: "state_inc", label: "State of incorporation" },
    { key: "years", label: "Years in business", type: "number", required: true },
  ] },
  { title: "Accounts payable", fields: [
    { key: "ap_name", label: "AP contact name", required: true },
    { key: "ap_phone", label: "AP phone", type: "tel", required: true },
    { key: "ap_email", label: "AP email", type: "email", required: true },
    { key: "invoice_email", label: "Send invoices to (email)", type: "email", required: true },
    { key: "po_required", label: "PO # required on invoices?", type: "select", options: ["No", "Yes"] },
    { key: "invoice_portal", label: "Invoice portal (if used)" },
    { key: "tax_exempt", label: "Tax exempt?", type: "select", options: ["No", "Yes"] },
  ] },
  { title: "Credit requested", fields: [
    { key: "requested_limit", label: "Requested credit limit ($)", type: "number", required: true },
    { key: "monthly_spend", label: "Estimated monthly freight spend ($)", type: "number" },
    { key: "loads_month", label: "Estimated loads per month", type: "number" },
  ] },
  { title: "Bank reference", fields: [
    { key: "bank_name", label: "Bank name", required: true },
    { key: "bank_contact", label: "Bank contact" },
    { key: "bank_phone", label: "Bank phone", type: "tel", required: true },
    { key: "bank_account_type", label: "Account type", type: "select", options: ["Checking", "Savings", "Line of credit"] },
  ] },
  ref(1), ref(2), ref(3),
  { title: "Owners / officers", fields: [
    { key: "officer1_name", label: "Name", required: true },
    { key: "officer1_title", label: "Title" },
    { key: "officer2_name", label: "Name (2nd)" },
    { key: "officer2_title", label: "Title (2nd)" },
  ] },
];

export const CREDIT_TERMS = `Terms & authorization
1. Payment terms are Net 30 days from invoice date unless Clearwater Cargo LLC agrees otherwise in writing. Credit limits are set at Clearwater Cargo's sole discretion and may be changed or withdrawn at any time.
2. Past-due balances accrue a late charge of 1.5% per month (18% per year) or the maximum allowed by law, whichever is less.
3. Customer agrees to pay all reasonable collection costs, including attorney fees, on past-due balances.
4. Freight charges are owed to Clearwater Cargo LLC as broker; Customer will not pay carriers directly for loads arranged by Clearwater Cargo. Payment disputes must be raised in writing within 15 days of the invoice.
5. Customer authorizes Clearwater Cargo LLC to contact the bank and trade references listed and to obtain business credit reports to evaluate this application.
6. The signer certifies the information is true and complete and that they are authorized to sign for the company.`;

export const requiredMissing = (a: Record<string, string>) =>
  CREDIT_SECTIONS.flatMap((s) => s.fields).filter((f) => f.required && !String(a[f.key] ?? "").trim()).map((f) => f.label);

export const creditAppUrl = (origin: string, token: string) => `${origin}/credit/${token}`;
export const creditEmailBody = (url: string, name?: string | null) =>
  `Hello${name ? ` ${name}` : ""},\n\nTo set up your account with Clearwater Cargo LLC, please fill out and sign our credit application online (about 5 minutes):\n${url}\n\nThank you,\nClearwater Cargo LLC · 252-497-7916`;
