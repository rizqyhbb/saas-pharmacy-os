/**
 * Local demo data, created through the real API (so every rule and audit event
 * applies): one apotek with an owner, a pharmacist and a cashier who can sign in, a
 * few products and opening stock. Safe to run twice: it reuses what exists.
 *
 *   pnpm db:start && pnpm --filter @apotek/api dev   # in another terminal
 *   pnpm seed:demo
 *
 * Local only. It refuses to run against anything but 127.0.0.1 / localhost.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:55321";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3101";
/** Keys come from the environment or the running local stack; never from source. */
function localKeys(): { publishable: string; secret: string } {
  const out = Bun.spawnSync(["supabase", "status", "-o", "json"], { stderr: "ignore" }).stdout.toString();
  const status = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as Record<string, string>;
  return { publishable: status.PUBLISHABLE_KEY ?? "", secret: status.SECRET_KEY ?? "" };
}
const fromStatus = process.env.SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SECRET_KEY ? null : localKeys();
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? fromStatus!.publishable;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? fromStatus!.secret;
if (!PUBLISHABLE_KEY || !SECRET_KEY) throw new Error("No Supabase keys: is `supabase start` running?");
const PASSWORD = "apotek123";

for (const url of [SUPABASE_URL, API_URL]) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error(`seed-demo is local only, refusing ${url}`);
}

const PEOPLE = {
  owner: { email: "pemilik@apotek.test", name: "Bu Rina (pemilik)" },
  pharmacist: { email: "apoteker@apotek.test", name: "apt. Dewi Lestari" },
  cashier: { email: "kasir@apotek.test", name: "Sari (kasir)" },
};

async function json(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/** A confirmed account with a password, via the Auth admin API. Existing ones are kept. */
async function ensureAccount(email: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SECRET_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  if (!response.ok && response.status !== 422) throw new Error(`create ${email}: HTTP ${response.status} ${await response.text()}`);
}

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await json(response);
  if (!body?.access_token) throw new Error(`sign in ${email}: HTTP ${response.status}`);
  return body.access_token;
}

async function api(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const isCsv = typeof body === "string";
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": isCsv ? "text/csv" : "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : isCsv ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await json(response) };
}

const PRODUCTS_CSV = `sku,brand_name,generic_name,strength,dosage_form,category,sales_class,controlled_class,unit_name,multiplier_to_base,sell_price,barcode,is_default_sale,is_default_purchase
PCT-500,Paracetamol,paracetamol,500 mg,tablet,Analgesik,OTC,NONE,tablet,1,500,,,
PCT-500,,,,,,,,strip,10,4500,8990000000017,ya,
PCT-500,,,,,,,,box,100,42000,8990000000024,,ya
VITC-500,Vitamin C,asam askorbat,500 mg,tablet,Vitamin,OTC,NONE,tablet,1,700,,,
VITC-500,,,,,,,,strip,10,6500,8990000000031,ya,
VITC-500,,,,,,,,box,100,60000,,,ya
AMX-500,Amoxicillin,amoksisilin,500 mg,kapsul,Antibiotik,RX_REQUIRED,NONE,kapsul,1,900,,,
AMX-500,,,,,,,,strip,10,8500,8990000000048,ya,
AMX-500,,,,,,,,box,100,80000,,,ya
`;

// Opening stock, with expiry relative to today so the demo never goes stale.
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const OPENING_CSV = `sku,location,unit_name,qty,batch_number,expiry_date
PCT-500,Utama,tablet,30,PCT-24A11,${day(-6)}
PCT-500,Utama,tablet,14,PCT-25C07,${day(38)}
PCT-500,Utama,box,2,PCT-26F02,${day(412)}
VITC-500,Utama,tablet,40,VC-25B10,${day(71)}
VITC-500,Utama,box,3,VC-26D04,${day(530)}
AMX-500,Utama,box,1,AMX-26A09,${day(300)}
`;

for (const person of Object.values(PEOPLE)) await ensureAccount(person.email);
const ownerToken = await signIn(PEOPLE.owner.email);

const me = await api(ownerToken, "GET", "/me");
let tenant = me.body.memberships.find((m: { tenantName: string }) => m.tenantName === "Apotek Sehat Sentosa");
if (!tenant) {
  const created = await api(ownerToken, "POST", "/tenants", {
    tenantName: "Apotek Sehat Sentosa",
    branchName: "Cabang Pusat",
    ownerDisplayName: PEOPLE.owner.name,
  });
  if (created.status !== 201) throw new Error(`register: ${JSON.stringify(created)}`);
  tenant = { tenantId: created.body.tenantId };
  console.log("Registered Apotek Sehat Sentosa");
}
const t = `/tenants/${tenant.tenantId}`;
const branchId = (await api(ownerToken, "GET", `${t}/branches`)).body.branches[0].branchId;

for (const [key, role] of [["pharmacist", "PHARMACIST"], ["cashier", "CASHIER"]] as const) {
  const invited = await api(ownerToken, "POST", `${t}/staff/invitations`, {
    email: PEOPLE[key].email,
    displayName: PEOPLE[key].name,
    role,
    branchIds: [branchId],
  });
  if (![201, 409].includes(invited.status)) throw new Error(`invite ${key}: ${JSON.stringify(invited)}`);
}

const staff = (await api(ownerToken, "GET", `${t}/staff`)).body.staff;
const apj = staff.find((s: { role: string }) => s.role === "PHARMACIST");
await api(ownerToken, "PUT", `${t}/facility`, {
  legalName: "PT Sehat Sentosa Farma (contoh)",
  apjStaffId: apj.staffId,
  apjName: PEOPLE.pharmacist.name,
  address: "Jl. Contoh No. 1, Jakarta",
  operatingHours: "Senin-Sabtu 08.00-21.00",
});

const products = await api(ownerToken, "POST", `${t}/imports/products`, PRODUCTS_CSV);
console.log("Products:", products.status === 201 ? "imported" : products.body.problems?.some((p: { code: string }) => p.code === "SKU_EXISTS") ? "already there" : JSON.stringify(products.body));

// A fixed document id makes the opening stock idempotent across runs.
const stock = await api(ownerToken, "POST", `${t}/imports/opening-stock`, OPENING_CSV, { "idempotency-key": "5eed0000-0000-4000-8000-000000000001" });
console.log("Opening stock:", stock.status === 201 ? "recorded" : stock.status === 200 ? "already recorded" : JSON.stringify(stock.body));

console.log(`
Demo apotek ready: Apotek Sehat Sentosa (${tenant.tenantId})
Sign in with password "${PASSWORD}":
  ${PEOPLE.owner.email}   OWNER
  ${PEOPLE.pharmacist.email}  PHARMACIST
  ${PEOPLE.cashier.email}      CASHIER
`);
