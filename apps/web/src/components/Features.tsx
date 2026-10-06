import Image from "next/image";
import { Package, WifiSlash } from "@phosphor-icons/react/ssr";
import { breakdown, formatQty } from "@apotek/domain";
import { cn, panelClass } from "@apotek/ui";
import { fill, type Copy } from "@/content/copy";
import shelfBottles from "@/assets/photos/shelf-bottles.jpg";
import { localToday } from "@/demo/dates";
import { demoReducer, initialState, sellableTotal, stockCard, type DemoAction } from "@/demo/engine";
import { BATCHES, productById } from "@/demo/seed";
import { Reveal } from "./Reveal";
import { Container } from "./ui";

/**
 * Five items, five cells. The small visuals are computed by the same engine
 * the demo runs, from the same sample data, so they can't drift from it.
 */
function sample() {
  const today = localToday();
  const opening = initialState(today);
  const sellTwoStrips: DemoAction[] = [
    { type: "ADD", productId: "pct", unitId: "pct-strip" },
    { type: "ADD", productId: "pct", unitId: "pct-strip" },
    { type: "CHECKOUT" },
  ];
  const afterSale = sellTwoStrips.reduce(demoReducer, opening);
  const product = productById("pct");
  const rows = stockCard(opening, product.id);
  const unitName = new Map(product.units.map((u) => [u.id, u.name]));
  const sellable = sellableTotal(rows);
  return {
    rows,
    sellable,
    sellableParts: breakdown(sellable, product.units)
      .map((line) => `${formatQty(line.qty)} ${unitName.get(line.unitId)}`)
      .join(" + "),
    saleRows: afterSale.log.filter((event) => event.eventType === "SALE"),
  };
}

const cell = cn(panelClass(), "flex min-w-0 flex-col p-[22px] md:p-7");
const body = "mt-2.5 max-w-[52ch] text-[0.98rem] text-muted";
const title = "text-[1.2rem] font-semibold leading-snug tracking-[-0.01em] text-balance";

export function Features({ copy }: { copy: Copy }) {
  const { features } = copy;
  // Copy order: FEFO, units, ledger, offline, receiving.
  const item = (i: number) => features.items[i]!;
  const [fefo, units, ledger, offline, receiving] = [item(0), item(1), item(2), item(3), item(4)];
  const { rows, sellable, sellableParts, saleRows } = sample();
  const firstSellable = rows.find((row) => !row.blocked);
  const batchNumber = new Map(BATCHES.map((b) => [b.id, b.batchNumber]));

  return (
    <section id="features" className="py-20 md:pb-[104px] md:pt-28">
      <Container>
        <Reveal>
          <h2 className="max-w-[22em] text-title text-balance">{features.title}</h2>
        </Reveal>
        <div className="mt-8 grid grid-cols-1 gap-3 md:mt-12 md:grid-cols-12 md:gap-4">
          {/* FEFO: tinted, with the batch order */}
          <Reveal className={cn(cell, "border-transparent bg-accent-soft md:col-span-12 lg:col-span-7")}>
            <h3 className={title}>{fefo.title}</h3>
            <p className={cn(body, "text-[color-mix(in_oklab,var(--ink)_78%,var(--accent-soft))]")}>{fefo.body}</p>
            <ol aria-label={features.fefoLabel} className="mt-auto grid gap-2 pt-7 sm:grid-cols-3 sm:gap-2.5">
              {rows.map((row) => {
                const tag = row.blocked
                  ? features.fefoTags.skipped
                  : row === firstSellable
                    ? features.fefoTags.first
                    : features.fefoTags.later;
                return (
                  <li
                    key={row.batch.id}
                    className={cn(
                      "flex items-center justify-between gap-2.5 rounded-control px-3.5 py-3 text-[0.82rem] leading-snug sm:block",
                      row.blocked ? "bg-surface/55 text-muted" : "bg-surface",
                      row === firstSellable && "shadow-[inset_0_0_0_1.5px_var(--accent)]",
                    )}
                  >
                    <span
                      className={cn(
                        "block font-mono text-[0.86rem] font-medium",
                        row.blocked && "line-through decoration-danger",
                      )}
                    >
                      {row.batch.batchNumber}
                    </span>
                    <span
                      className={cn(
                        "block font-medium sm:mt-1.5",
                        row.blocked ? "text-danger" : row === firstSellable ? "text-accent-soft-ink" : "text-muted",
                      )}
                    >
                      {tag}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Reveal>

          {/* Receiving: the photo cell */}
          <Reveal className={cn(panelClass(), "flex min-w-0 flex-col overflow-hidden md:col-span-6 md:row-span-2 lg:col-span-5")}>
            <div className="relative aspect-[16/10] bg-sunk md:aspect-auto md:min-h-[260px] md:flex-1">
              <Image
                src={shelfBottles}
                alt={features.photoAlt}
                fill
                sizes="(min-width: 1024px) 480px, (min-width: 768px) 50vw, 100vw"
                placeholder="blur"
                className="object-cover object-[30%_60%]"
              />
            </div>
            <div className="px-[22px] pb-6 pt-5 md:px-7 md:pb-7 md:pt-[26px]">
              <h3 className={title}>{receiving.title}</h3>
              <p className={body}>{receiving.body}</p>
            </div>
          </Reveal>

          {/* Units: live breakdown */}
          <Reveal className={cn(cell, "md:col-span-6 lg:col-span-3")}>
            <Package aria-hidden className="mb-5 size-7 text-accent" />
            <h3 className={title}>{units.title}</h3>
            <p className={cn(body, "mb-5")}>{units.body}</p>
            <div className="mt-auto flex flex-col border-t border-line pt-5">
              <span className="font-mono text-[0.95rem] font-medium tabular-nums">{sellableParts}</span>
              <span className="mt-2 text-[0.78rem] text-muted">{fill(features.unitsCaption, { qty: formatQty(sellable) })}</span>
            </div>
          </Reveal>

          {/* Ledger: the rows one sale writes */}
          <Reveal className={cn(cell, "md:col-span-6 lg:col-span-4")}>
            <h3 className={title}>{ledger.title}</h3>
            <p className={body}>{ledger.body}</p>
            <ol className="mt-auto pt-5 font-mono text-[0.8rem] tabular-nums">
              {saleRows.map((event) => (
                <li key={event.idempotencyKey} className="grid grid-cols-[auto_1fr_auto] gap-2.5 border-t border-line py-[7px]">
                  <span>{event.reference.id}</span>
                  <span className="text-muted">{event.batchId ? batchNumber.get(event.batchId) : ""}</span>
                  <span>{formatQty(event.qtyDeltaBase).replace("-", "−")}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[0.78rem] text-muted">{features.ledgerCaption}</p>
          </Reveal>

          {/* Offline: full-width strip */}
          <Reveal
            className={cn(
              cell,
              "grid gap-3.5 md:col-span-12 md:grid-cols-[auto_minmax(0,4fr)_minmax(0,6fr)] md:items-center md:gap-6",
            )}
          >
            <span aria-hidden className="grid size-16 place-items-center rounded-control bg-sunk">
              <WifiSlash className="size-[34px] text-accent" />
            </span>
            <h3 className={title}>{offline.title}</h3>
            <p className="max-w-[52ch] text-[0.98rem] text-muted">{offline.body}</p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
