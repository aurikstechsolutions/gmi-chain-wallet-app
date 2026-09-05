export const PAYMENT_METHODS = [
  { id: "bank_transfer",   label: "Bank Transfer" },
  { id: "upi",            label: "UPI" },
  { id: "phonepe",        label: "PhonePe" },
  { id: "google_pay",     label: "Google Pay" },
  { id: "paytm",          label: "Paytm" },
  { id: "paypal",         label: "PayPal" },
  { id: "revolut",        label: "Revolut" },
  { id: "wise",           label: "Wise" },
  { id: "cash",           label: "Cash" },
  { id: "crypto_transfer", label: "Crypto Transfer" },
] as const;

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]["id"];

export interface MethodField {
  key: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
  keyboardType?: "default" | "email-address" | "phone-pad" | "numeric";
}

export const METHOD_LABELS: Record<string, string> = {
  bank_transfer:   "Bank Transfer",
  upi:             "UPI",
  phonepe:         "PhonePe",
  google_pay:      "Google Pay",
  paytm:           "Paytm",
  paypal:          "PayPal",
  revolut:         "Revolut",
  wise:            "Wise",
  cash:            "Cash",
  crypto_transfer: "Crypto Transfer",
  other:           "Other",
};

export const METHOD_FIELDS: Record<string, MethodField[]> = {
  bank_transfer: [
    { key: "accountHolder", label: "Account Holder Name",  placeholder: "Full name as on account" },
    { key: "accountNumber", label: "Account Number",       placeholder: "1234 5678 9012", keyboardType: "numeric" },
    { key: "ifsc",          label: "IFSC / Sort Code",     placeholder: "SBIN0001234" },
    { key: "bankName",      label: "Bank Name",            placeholder: "State Bank of India" },
  ],
  upi: [
    { key: "upiId", label: "UPI ID", placeholder: "yourname@upi" },
  ],
  phonepe: [
    { key: "phone", label: "PhonePe Number", placeholder: "9876543210", keyboardType: "phone-pad" },
  ],
  google_pay: [
    { key: "upiId", label: "UPI ID / Phone", placeholder: "yourname@okaxis or 9876543210" },
  ],
  paytm: [
    { key: "phone", label: "Paytm Number", placeholder: "9876543210", keyboardType: "phone-pad" },
  ],
  paypal: [
    { key: "email", label: "PayPal Email", placeholder: "you@example.com", keyboardType: "email-address" },
  ],
  revolut: [
    { key: "handle", label: "Revolut Username / Phone", placeholder: "@username or +44 7700 900000" },
  ],
  wise: [
    { key: "email", label: "Wise Email", placeholder: "you@example.com", keyboardType: "email-address" },
  ],
  cash: [
    { key: "notes", label: "Meeting Instructions", placeholder: "Location, time, or any notes…", multiline: true },
  ],
  crypto_transfer: [
    { key: "address", label: "Wallet Address", placeholder: "0x… or bc1…" },
    { key: "network", label: "Network / Chain",  placeholder: "e.g. Ethereum, BNB Smart Chain" },
  ],
  other: [
    { key: "details", label: "Details", placeholder: "Payment instructions…", multiline: true },
  ],
};

export function formatDetails(method: string, details: Record<string, string>): string {
  const fields = METHOD_FIELDS[method] ?? [];
  if (fields.length === 0) return Object.values(details).filter(Boolean).join(" · ");
  return fields
    .map(f => details[f.key] ? `${f.label}: ${details[f.key]}` : null)
    .filter(Boolean)
    .join("\n");
}

export function formatDetailsSingleLine(method: string, details: Record<string, string>): string {
  const fields = METHOD_FIELDS[method] ?? [];
  if (fields.length === 0) return Object.values(details).filter(Boolean).join(" · ");
  return fields
    .map(f => details[f.key] || null)
    .filter(Boolean)
    .join(" · ");
}
