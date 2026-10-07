import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connect } from "@apotek/db/testing";
import { parseCsv } from "../src/csv";
import { call, tenantWithEveryRole, testApp, token, type RoleTenant } from "./support";

const sql = await connect();
afterAll(() => sql?.end());

describe.skipIf(!sql)("CSV import and export (FND-7)", () => {
  const db = sql!;
  const app = testApp(db);
  let t: RoleTenant;
  const path = (p: string) => `/tenants/${t.tenantId}${p}`;
  const as = (role: keyof RoleTenant["staff"]) => t.staff[role].userId;
  const suffix = () => crypto.randomUUID().slice(0, 6);

  async function upload(route: string, userId: string, csv: string, headers: Record<string, string> = {}) {
    const response = await app.handle(
      new Request(`http://localhost${path(route)}`, {
        method: "POST",
        headers: { authorization: `Bearer ${await token(userId)}`, "content-type": "text/csv", ...headers },
        body: csv,
      }),
    );
    return { status: response.status, body: (await response.json()) as any };
  }
  async function download(route: string, userId: string) {
    const response = await app.handle(new Request(`http://localhost${path(route)}`, { headers: { authorization: `Bearer ${await token(userId)}` } }));
    return { status: response.status, type: response.headers.get("content-type"), text: await response.text() };
  }

  beforeAll(async () => {
    t = await tenantWithEveryRole(app, db, "Apotek Impor");
  });

  test("a product file imports every product, unit and barcode in one go", async () => {
    const s = suffix();
    const csv = [
      "sku,brand_name,generic_name,strength,sales_class,unit_name,multiplier_to_base,sell_price,barcode,is_default_sale",
      `PCT-${s},Paracetamol,paracetamol,500 mg,OTC,tablet,1,500,,`,
      `PCT-${s},,,,,strip,10,4.500,899${s}01,ya`,
      `PCT-${s},,,,,box,100,42000,,`,
      `VITC-${s},Vitamin C,asam askorbat,500 mg,,tablet,1,700,,`,
    ].join("\n");
    const res = await upload("/imports/products", as("OWNER"), csv);
    expect(res).toEqual({ status: 201, body: { dryRun: false, valid: true, problems: [], summary: { products: 2, units: 4 } } });

    const found = (await call(app, "GET", path(`/products?q=PCT-${s}`), { userId: as("OWNER") })).body.products;
    expect(found[0]).toMatchObject({ salesClass: "OTC", sellable: true });
    expect(found[0].units.map((u: { name: string; sellPrice: number }) => [u.name, u.sellPrice])).toEqual([
      ["tablet", 500],
      ["strip", 4500],
      ["box", 42000],
    ]);
    const vitc = (await call(app, "GET", path(`/products?q=VITC-${s}`), { userId: as("OWNER") })).body.products[0];
    expect(vitc.sellable).toBe(false); // no class given: waits for a pharmacist
  });

  test("problems are reported by line and column, and nothing is written", async () => {
    const s = suffix();
    const csv = [
      "sku,brand_name,unit_name,multiplier_to_base,sell_price",
      `A-${s},Obat A,tablet,1,4.5`,
      `B-${s},,strip,10,`,
      `C-${s},Obat C,tablet,abc,`,
    ].join("\n");
    const res = await upload("/imports/products", as("OWNER"), csv);
    expect(res.status).toBe(422);
    expect(res.body.problems).toEqual([
      { line: 2, column: "sell_price", code: "NOT_WHOLE_RUPIAH" },
      { line: 3, column: "brand_name", code: "REQUIRED" },
      { line: 3, column: "unit_name", code: "NO_BASE_UNIT" },
      { line: 4, column: "multiplier_to_base", code: "NOT_A_QUANTITY" },
    ]);
    const after = (await call(app, "GET", path(`/products?q=${s}`), { userId: as("OWNER") })).body.products;
    expect(after).toEqual([]);
  });

  test("a dry run checks without writing; existing SKUs and barcodes are refused", async () => {
    const s = suffix();
    const csv = `sku;brand_name;unit_name;multiplier_to_base;barcode\nDRY-${s};Obat Kering;tablet;1;77${s}\n`;
    expect(await upload("/imports/products?dryRun=true", as("OWNER"), csv)).toEqual({
      status: 200,
      body: { dryRun: true, valid: true, problems: [], summary: { products: 1, units: 1 } },
    });
    expect((await call(app, "GET", path(`/products?q=DRY-${s}`), { userId: as("OWNER") })).body.products).toEqual([]);
    expect((await upload("/imports/products", as("OWNER"), csv)).status).toBe(201);
    const again = await upload("/imports/products", as("OWNER"), csv.replace(`DRY-${s}`, `DRY2-${s}`));
    expect(again.body.problems).toEqual([{ line: 2, column: "barcode", code: "BARCODE_EXISTS" }]);
    const sameSku = await upload("/imports/products", as("OWNER"), csv.replace(`77${s}`, `78${s}`));
    expect(sameSku.body.problems).toEqual([{ line: 2, column: "sku", code: "SKU_EXISTS" }]);
  });

  test("only a classifier may set classes in a file", async () => {
    const csv = `sku,brand_name,sales_class,unit_name,multiplier_to_base\nRX-${suffix()},Amoxicillin,RX_REQUIRED,kapsul,1\n`;
    const res = await upload("/imports/products", as("PURCHASING"), csv);
    expect(res.body.problems).toEqual([{ line: 2, column: "sales_class", code: "NEEDS_PRODUCT_CLASSIFY" }]);
    expect((await upload("/imports/products", as("CASHIER"), csv)).status).toBe(403);
  });

  test("opening stock from Indonesian Excel: ';', decimal comma and DD/MM/YYYY dates, recorded once", async () => {
    const s = suffix();
    await upload(
      "/imports/products",
      as("OWNER"),
      `sku,brand_name,sales_class,unit_name,multiplier_to_base\nST-${s},Sirup,OTC,ml,1\nST-${s},,,botol,60\n`,
    );
    const csv = `sku;location;unit_name;qty;batch_number;expiry_date\nST-${s};Utama;botol;2,5;SY-1;31/12/2099\nST-${s};utama;ml;30;SY-2;2099-06-30\n`;
    const key = crypto.randomUUID();
    const first = await upload("/imports/opening-stock", as("WAREHOUSE"), csv, { "idempotency-key": key });
    expect(first).toMatchObject({ status: 201, body: { valid: true, summary: { lines: 2, products: 1 }, replayed: false } });
    const replay = await upload("/imports/opening-stock", as("WAREHOUSE"), csv, { "idempotency-key": key });
    expect(replay).toMatchObject({ status: 200, body: { replayed: true } });

    const product = (await call(app, "GET", path(`/products?q=ST-${s}`), { userId: as("OWNER") })).body.products[0];
    const card = (await call(app, "GET", path(`/products/${product.id}/stock`), { userId: as("OWNER") })).body;
    expect(card.batches.map((b: { batchNumber: string; expiryDate: string; onHand: string }) => [b.batchNumber, b.expiryDate, b.onHand])).toEqual([
      ["SY-2", "2099-06-30", "30"],
      ["SY-1", "2099-12-31", "150"],
    ]);
  });

  test("opening stock rows are checked against the catalogue and the caller's locations", async () => {
    const csv = [
      "sku,location,unit_name,qty,batch_number,expiry_date",
      "NOPE,Utama,tablet,1,X,2099-01-01",
      "",
    ].join("\n");
    const res = await upload("/imports/opening-stock?dryRun=true", as("OWNER"), csv);
    expect(res.body.problems).toEqual([{ line: 2, column: "sku", code: "UNKNOWN_SKU" }]);
    expect((await upload("/imports/opening-stock", as("OWNER"), csv)).status).toBe(400); // no Idempotency-Key
  });

  test("exports: products in the import format round-trip; stock lists balances", async () => {
    const s = suffix();
    await upload(
      "/imports/products",
      as("OWNER"),
      `sku,brand_name,strength,sales_class,unit_name,multiplier_to_base,sell_price\nEX-${s},Ekspor,"10 mg, salut",OTC,tablet,1,900\n`,
    );
    const exported = await download("/exports/products.csv", as("CASHIER"));
    expect(exported.type).toBe("text/csv; charset=utf-8");
    const rows = parseCsv(exported.text).rows.filter((r) => r.values.sku === `EX-${s}`);
    expect(rows.map((r) => r.values)).toEqual([
      expect.objectContaining({ brand_name: "Ekspor", strength: "10 mg, salut", sales_class: "OTC", unit_name: "tablet", sell_price: "900" }),
    ]);

    // Re-import the exported rows under new SKUs into another tenant: the format is accepted as-is.
    const other = await tenantWithEveryRole(app, db, "Apotek Tujuan");
    const header = parseCsv(exported.text).header.join(",");
    const reimport = await app.handle(
      new Request(`http://localhost/tenants/${other.tenantId}/imports/products?dryRun=true`, {
        method: "POST",
        headers: { authorization: `Bearer ${await token(other.staff.OWNER.userId)}`, "content-type": "text/csv" },
        body: exported.text,
      }),
    );
    expect(((await reimport.json()) as { valid: boolean }).valid).toBe(true);
    expect(header.startsWith("sku,brand_name")).toBe(true);

    const stock = await download("/exports/stock.csv", as("OWNER"));
    expect(parseCsv(stock.text).header).toEqual(["sku", "brand_name", "strength", "branch", "location", "batch_number", "expiry_date", "status", "on_hand", "reserved", "base_unit"]);
  });

  test("templates carry the columns", async () => {
    const products = await download("/imports/products/template.csv", as("CASHIER"));
    expect(parseCsv(products.text).header[0]).toBe("sku");
    const stock = await download("/imports/opening-stock/template.csv", as("CASHIER"));
    expect(parseCsv(stock.text).header).toContain("expiry_date");
  });
});
