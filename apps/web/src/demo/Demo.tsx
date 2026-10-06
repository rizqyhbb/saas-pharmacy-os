"use client";

import { useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowCounterClockwise, LockSimple, Plus, WifiHigh, WifiSlash, X } from "@phosphor-icons/react";
import { breakdown, formatQty, QTY_SCALE, type Qty } from "@apotek/domain";
import { Button, Chip, cn, Panel, Segmented, Stepper, Switch, Tabs, tabPanelProps, type ChipTone } from "@apotek/ui";
import { fill, type Copy, type Lang } from "@/content/copy";
import { localToday } from "./dates";
import {
  cartAllocations,
  cartTotal,
  currentStep,
  demoReducer,
  initialState,
  linePrice,
  sellableTotal,
  stepActions,
  stockCard,
  TOUR,
  type DemoAction,
  type DemoState,
  type Milestone,
  type Notice,
  type StockCardRow,
} from "./engine";
import { BATCHES, PRODUCTS, baseUnitOf, productById, unitById, type DemoProduct } from "./seed";

type UiCopy = Copy["demoUi"];
type Target = "products" | "fefo" | "pay" | "connection";
type Tab = "stock" | "ledger" | "sync";

/** Which part of the counter each tour step points at. */
const STEP_TARGET: Record<Milestone, Target> = {
  ADDED_PCT_STRIPS: "products",
  SEEN_FEFO: "fefo",
  SOLD_PCT: "pay",
  RX_BLOCKED: "products",
  QUEUED_OFFLINE: "connection",
  SYNCED: "connection",
};

const MINUS = "−";
const label = "text-[0.82rem] font-medium text-muted";

/** A ring around the part of the counter the current tour step is about. */
function Highlight({ on, children, className = "" }: { on: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-control transition-shadow duration-300",
        on && "shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--accent)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function formatStock(product: DemoProduct, base: Qty): string {
  const names = new Map(product.units.map((u) => [u.id, u.name]));
  if (base <= 0n) return `${formatQty(base)} ${baseUnitOf(product).name}`;
  return breakdown(base, product.units)
    .map((line) => `${formatQty(line.qty)} ${names.get(line.unitId)}`)
    .join(" + ");
}

const signed = (qty: Qty) => (qty > 0n ? `+${formatQty(qty)}` : formatQty(qty).replace("-", MINUS));

export function Demo({ lang, copy }: { lang: Lang; copy: UiCopy }) {
  const [state, dispatch] = useReducer(demoReducer, undefined, () => initialState(localToday()));
  const [tab, setTab] = useState<Tab>("stock");
  const [stockProductId, setStockProductId] = useState("pct");
  const reduce = useReducedMotion() ?? false;
  const rupiah = useMemo(
    () => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }),
    [],
  );

  const step = currentStep(state);
  const finished = step >= TOUR.length;
  const target = finished ? null : STEP_TARGET[TOUR[step]!];
  const doIt = () => stepActions(state, TOUR[step]!).forEach(dispatch);
  const reset = () => {
    dispatch({ type: "RESET", today: localToday() });
    setTab("stock");
    setStockProductId("pct");
  };

  // Point the records pane at whatever the last action changed.
  useEffect(() => {
    const kind = state.notice?.kind;
    if (kind === "SOLD") setTab("ledger");
    if (kind === "SYNCED") setTab("sync");
    if (kind === "QUEUED") {
      setTab("stock");
      const productId = state.outbox.at(-1)?.events[0]?.productId;
      if (productId) setStockProductId(productId);
    }
  }, [state.notice, state.outbox]);

  return (
    <div>
      <Panel raised className="overflow-hidden">
        <TourStrip copy={copy} state={state} step={step} reduce={reduce} onDoIt={doIt} onReset={reset} />
        <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <CounterPane copy={copy} state={state} dispatch={dispatch} target={target} rupiah={rupiah} reduce={reduce} />
          <RecordsPane
            copy={copy}
            lang={lang}
            state={state}
            tab={tab}
            setTab={setTab}
            stockProductId={stockProductId}
            setStockProductId={setStockProductId}
            reduce={reduce}
          />
        </div>
      </Panel>
      {!finished && <TourDock copy={copy} step={step} onDoIt={doIt} />}
    </div>
  );
}

function TourStrip({
  copy,
  state,
  step,
  reduce,
  onDoIt,
  onReset,
}: {
  copy: UiCopy;
  state: DemoState;
  step: number;
  reduce: boolean;
  onDoIt: () => void;
  onReset: () => void;
}) {
  const finished = step >= TOUR.length;
  const current = copy.steps[step];
  return (
    <section
      aria-label={copy.tourTitle}
      className="flex flex-col gap-4 border-b border-line bg-accent-soft/45 px-5 py-4 md:flex-row md:items-start md:justify-between md:gap-8 md:px-7 md:py-5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <ol aria-hidden className="flex gap-1">
            {TOUR.map((milestone, i) => (
              <li
                key={milestone}
                className={cn(
                  "h-1 w-5 rounded-full transition-colors md:w-6",
                  state.milestones.includes(milestone) ? "bg-accent" : i === step ? "bg-accent/45" : "bg-line",
                )}
              />
            ))}
          </ol>
          <span className="font-mono text-[0.76rem] text-muted">
            {finished ? `${TOUR.length}/${TOUR.length}` : fill(copy.stepOf, { n: step + 1, total: TOUR.length })}
          </span>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={finished ? "done" : step}
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: reduce ? 0 : 0.22 }}
            className="mt-2.5"
          >
            <p className="font-semibold" aria-current={finished ? undefined : "step"}>
              {finished ? copy.doneTitle : current?.title}
            </p>
            <p className="mt-1 max-w-[70ch] text-[0.92rem] leading-relaxed text-muted">
              {finished ? copy.doneBody : current?.body}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex shrink-0 items-center gap-2 md:pt-6">
        {!finished && (
          <Button size="sm" onClick={onDoIt}>
            {TOUR[step] === "SEEN_FEFO" ? copy.next : copy.doIt}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onReset}>
          <ArrowCounterClockwise aria-hidden className="size-4" />
          {copy.restart}
        </Button>
      </div>
    </section>
  );
}

/**
 * On small screens the tour strip scrolls away above the counter, so the current
 * step also docks to the bottom of the screen while the demo is in view.
 */
function TourDock({ copy, step, onDoIt }: { copy: UiCopy; step: number; onDoIt: () => void }) {
  return (
    <div className="sticky bottom-3 z-20 mt-4 lg:hidden">
      <div className="flex items-center justify-between gap-3 rounded-panel border border-line bg-surface/95 px-4 py-3 shadow-panel backdrop-blur">
        <div className="min-w-0">
          <p className="font-mono text-[0.7rem] text-muted">{fill(copy.stepOf, { n: step + 1, total: TOUR.length })}</p>
          <p className="line-clamp-2 text-[0.88rem] font-medium leading-snug">{copy.steps[step]?.title}</p>
        </div>
        <Button size="sm" onClick={onDoIt}>
          {TOUR[step] === "SEEN_FEFO" ? copy.next : copy.doIt}
        </Button>
      </div>
    </div>
  );
}

function CounterPane({
  copy,
  state,
  dispatch,
  target,
  rupiah,
  reduce,
}: {
  copy: UiCopy;
  state: DemoState;
  dispatch: (action: DemoAction) => void;
  target: Target | null;
  rupiah: Intl.NumberFormat;
  reduce: boolean;
}) {
  const c = copy.counter;
  const total = cartTotal(state.cart);

  return (
    <section aria-label={c.title} className="flex min-w-0 flex-col p-5 md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[1.05rem] font-semibold">{c.title}</h3>
        <Highlight on={target === "connection"}>
          <div className="flex items-center gap-1.5 pl-2">
            <span className="text-[0.88rem] text-muted">{c.connection}</span>
            <Switch
              checked={state.online}
              onChange={(online) => dispatch({ type: "SET_ONLINE", online })}
              aria-label={c.connection}
            >
              <span className={cn("inline-flex items-center gap-1.5", state.online ? "text-ink" : "text-warn")}>
                {state.online ? <WifiHigh aria-hidden className="size-4" /> : <WifiSlash aria-hidden className="size-4" />}
                {state.online ? c.online : c.offline}
                {state.outbox.length > 0 && <span className="font-mono">({state.outbox.length})</span>}
              </span>
            </Switch>
          </div>
        </Highlight>
      </div>

      <Highlight on={target === "products"} className="mt-4 p-1">
        <h4 className={cn(label, "px-1")}>{c.products}</h4>
        <ul className="mt-1 divide-y divide-line">
          {PRODUCTS.map((product) => (
            <ProductRow key={product.id} product={product} state={state} copy={c} dispatch={dispatch} />
          ))}
        </ul>
      </Highlight>

      <NoticeBar
        notice={state.notice}
        copy={copy}
        rupiah={rupiah}
        reduce={reduce}
        onDismiss={() => dispatch({ type: "DISMISS_NOTICE" })}
      />

      <h4 className={cn(label, "mt-5")}>{c.cart}</h4>
      {state.cart.length === 0 ? (
        <p className="mt-2.5 rounded-control border border-dashed border-line px-4 py-5 text-center text-[0.9rem] text-muted">
          {c.emptyCart}
        </p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {state.cart.map((line) => {
            const product = productById(line.productId);
            const unit = unitById(product, line.unitId);
            const item = `${unit.name} ${product.name}`;
            return (
              <li key={`${line.productId}/${line.unitId}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                <span className="min-w-0 truncate text-[0.95rem]">
                  {product.name} <span className="text-muted">{unit.name}</span>
                </span>
                <Stepper
                  size="sm"
                  value={formatQty(line.qty)}
                  decrementLabel={fill(c.decrease, { item })}
                  incrementLabel={fill(c.increase, { item })}
                  onDecrement={() =>
                    dispatch({ type: "SET_QTY", productId: line.productId, unitId: line.unitId, qty: line.qty - QTY_SCALE })
                  }
                  onIncrement={() => dispatch({ type: "ADD", productId: line.productId, unitId: line.unitId })}
                />
                <span className="w-[5.5rem] text-right font-mono text-[0.88rem] tabular-nums">
                  {rupiah.format(linePrice(line))}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {state.cart.length > 0 && (
        <Highlight on={target === "fefo"} className="mt-3 p-1">
          <FefoPreview copy={copy} state={state} />
        </Highlight>
      )}

      <div className="mt-auto pt-5">
        <div className="flex items-baseline justify-between border-t border-line pt-4">
          <span>{c.total}</span>
          <span className="font-mono text-[1.45rem] font-medium tracking-[-0.02em] tabular-nums">{rupiah.format(total)}</span>
        </div>
        <Highlight on={target === "pay"} className="mt-3.5">
          <Button block disabled={state.cart.length === 0} onClick={() => dispatch({ type: "CHECKOUT" })}>
            {state.online ? c.pay : c.payOffline}
          </Button>
        </Highlight>
      </div>
    </section>
  );
}

/**
 * Which batches the sale will use. Blocked batches that still hold stock are
 * listed first and struck through: that is the part people need to see.
 */
function FefoPreview({ copy, state }: { copy: UiCopy; state: DemoState }) {
  const c = copy.counter;
  const batchNumber = new Map(BATCHES.map((b) => [b.id, b.batchNumber]));
  return (
    <div>
      <p className={label}>{c.fefoTitle}</p>
      <div className="mt-2 grid gap-2">
        {cartAllocations(state).map(({ productId, requested, result }) => {
          const product = productById(productId);
          const skipped = stockCard(state, productId).filter((row) => row.blocked && row.onHand > 0n);
          return (
            <ul key={productId} className="overflow-hidden rounded-control border border-line text-[0.88rem]">
              <li className="bg-sunk px-3.5 py-2 text-[0.8rem] text-muted">
                {product.name} = {fill(c.baseEq, { qty: formatQty(requested) })}
              </li>
              {skipped.map((row) => (
                <li key={row.batch.id} className="border-t border-line bg-danger-soft/45 px-3.5 py-2.5 text-muted">
                  <span className="font-mono line-through decoration-danger decoration-[1.5px]">{row.batch.batchNumber}</span>
                  {": "}
                  {fill(c.skipped, { qty: formatQty(row.onHand) })}
                </li>
              ))}
              {result.ok ? (
                result.value.map((allocation) => (
                  <li key={allocation.batchId} className="border-t border-line px-3.5 py-2.5 font-mono tabular-nums">
                    {fill(c.takeFrom, {
                      qty: formatQty(allocation.qty),
                      batch: batchNumber.get(allocation.batchId) ?? allocation.batchId,
                    })}
                  </li>
                ))
              ) : (
                <li className="border-t border-line bg-danger-soft/45 px-3.5 py-2.5 font-medium text-danger">
                  {fill(copy.notices.INSUFFICIENT, { product: product.name, qty: formatQty(result.error.shortfall) })}
                </li>
              )}
            </ul>
          );
        })}
      </div>
    </div>
  );
}

function ProductRow({
  product,
  state,
  copy,
  dispatch,
}: {
  product: DemoProduct;
  state: DemoState;
  copy: UiCopy["counter"];
  dispatch: (action: DemoAction) => void;
}) {
  const [unitId, setUnitId] = useState(product.defaultUnitId);
  const sellable = sellableTotal(stockCard(state, product.id));
  const rx = product.salesClass === "RX_REQUIRED";
  return (
    <li className="px-1 py-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
        <span className="whitespace-nowrap">
          {product.name} <span className="font-normal text-muted">{product.strength}</span>
        </span>
        {rx && <Chip tone="danger">{copy.rxBadge}</Chip>}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="whitespace-nowrap font-mono text-[0.76rem] text-muted">{fill(copy.sellable, { qty: formatQty(sellable) })}</p>
        <div className="flex items-center gap-2">
          <Segmented
            size="sm"
            name={`unit-${product.id}`}
            legend={fill(copy.unitLabel, { product: product.name })}
            hideLegend
            options={product.units.map((unit) => ({ value: unit.id, label: unit.name }))}
            value={unitId}
            onChange={setUnitId}
          />
          <Button size="sm" variant="secondary" onClick={() => dispatch({ type: "ADD", productId: product.id, unitId })}>
            <Plus aria-hidden className="size-3.5" weight="bold" />
            {copy.add}
          </Button>
        </div>
      </div>
    </li>
  );
}

function NoticeBar({
  notice,
  copy,
  rupiah,
  reduce,
  onDismiss,
}: {
  notice: Notice | null;
  copy: UiCopy;
  rupiah: Intl.NumberFormat;
  reduce: boolean;
  onDismiss: () => void;
}) {
  const n = copy.notices;
  const message = (() => {
    if (!notice) return null;
    switch (notice.kind) {
      case "RX_BLOCKED":
        return { tone: "bg-danger-soft text-danger", text: fill(n.RX_BLOCKED, { product: productById(notice.productId).name }) };
      case "INSUFFICIENT":
        return {
          tone: "bg-danger-soft text-danger",
          text: fill(n.INSUFFICIENT, { product: productById(notice.productId).name, qty: formatQty(notice.shortfall) }),
        };
      case "SOLD":
        return { tone: "bg-accent-soft text-ink", text: fill(n.SOLD, { sale: notice.saleNo, total: rupiah.format(notice.total) }) };
      case "QUEUED":
        return { tone: "bg-warn-soft text-ink", text: fill(n.QUEUED, { sale: notice.saleNo }) };
      case "SYNCED":
        return { tone: "bg-accent-soft text-ink", text: fill(n.SYNCED, { n: notice.sales }) };
    }
  })();

  return (
    <div role="status" aria-live="polite" className={message ? "mt-3" : ""}>
      <AnimatePresence mode="wait" initial={false}>
        {message && (
          <motion.div
            key={message.text}
            initial={reduce ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.25 }}
            className={cn("flex items-start justify-between gap-3 rounded-control px-4 py-3 text-[0.9rem] leading-relaxed", message.tone)}
          >
            <span>{message.text}</span>
            <button type="button" aria-label={n.dismiss} onClick={onDismiss} className="mt-0.5 shrink-0 rounded-control opacity-70 hover:opacity-100">
              <X aria-hidden className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RecordsPane({
  copy,
  lang,
  state,
  tab,
  setTab,
  stockProductId,
  setStockProductId,
  reduce,
}: {
  copy: UiCopy;
  lang: Lang;
  state: DemoState;
  tab: Tab;
  setTab: (tab: Tab) => void;
  stockProductId: string;
  setStockProductId: (id: string) => void;
  reduce: boolean;
}) {
  const p = copy.panels;
  const ledgerRows = state.log.length + state.outbox.reduce((sum, sale) => sum + sale.events.length, 0);
  const count = (n: number, tone: "neutral" | "warn") => (
    <span
      className={cn(
        "rounded-full px-[7px] py-px font-mono text-[0.72rem]",
        tone === "warn" ? "bg-warn-soft text-warn" : "bg-line/70 text-muted",
      )}
    >
      {n}
    </span>
  );
  return (
    <section
      aria-label={`${p.stock}, ${p.ledger}, ${p.sync}`}
      className="flex min-w-0 flex-col border-t border-line p-5 md:p-7 lg:min-h-[30rem] lg:border-l lg:border-t-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          idPrefix="demo"
          label={p.sample}
          value={tab}
          onChange={setTab}
          className="w-full sm:w-auto"
          tabs={[
            { id: "stock", label: p.stock },
            { id: "ledger", label: <>{p.ledger} {count(ledgerRows, "neutral")}</> },
            {
              id: "sync",
              label: (
                <>
                  {p.sync} {state.outbox.length > 0 && count(state.outbox.length, "warn")}
                </>
              ),
            },
          ]}
        />
        <span className="hidden sm:block">
          <Chip tone="outline">{p.sample}</Chip>
        </span>
      </div>
      <div {...tabPanelProps("demo", tab)} className="mt-5 flex-1 rounded-control">
        {tab === "stock" && <StockTab copy={copy} state={state} productId={stockProductId} setProductId={setStockProductId} />}
        {tab === "ledger" && <LedgerTab copy={copy} lang={lang} state={state} reduce={reduce} />}
        {tab === "sync" && <SyncTab copy={copy} state={state} reduce={reduce} />}
      </div>
    </section>
  );
}

const BAND_TONE: Record<StockCardRow["band"], ChipTone> = { EXPIRED: "danger", NEAR: "warn", OK: "ok" };

function StockTab({
  copy,
  state,
  productId,
  setProductId,
}: {
  copy: UiCopy;
  state: DemoState;
  productId: string;
  setProductId: (id: string) => void;
}) {
  const p = copy.panels;
  const product = productById(productId);
  const rows = stockCard(state, productId);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {PRODUCTS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === productId}
            onClick={() => setProductId(item.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-[0.82rem] transition-colors",
              item.id === productId ? "border-ink bg-ink text-bg" : "border-line text-muted hover:text-ink",
            )}
          >
            {item.name}
          </button>
        ))}
      </div>
      <table className="mt-4 w-full border-collapse text-[0.9rem]">
        <thead>
          <tr className="text-left text-[0.78rem] text-muted">
            <th scope="col" className="border-b border-line pb-2.5 pr-3 font-medium">
              {p.batch}
            </th>
            <th scope="col" className="hidden border-b border-line px-3 pb-2.5 font-medium sm:table-cell">
              {p.expiry}
            </th>
            <th scope="col" className="border-b border-line pb-2.5 pl-3 text-right font-medium sm:pr-3">
              {p.onHand}
            </th>
            <th scope="col" className="hidden border-b border-line pb-2.5 pl-3 text-right font-medium sm:table-cell">
              <span className="sr-only">Status</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expiry =
              row.daysToExpiry < 0 ? fill(p.daysAgo, { n: -row.daysToExpiry }) : fill(p.daysLeft, { n: row.daysToExpiry });
            return (
              <tr key={row.batch.id} className={row.nextToSell ? "bg-accent-soft/55" : ""}>
                <td
                  className={cn(
                    "border-b border-line py-3 pr-3 align-middle",
                    row.nextToSell && "pl-3 shadow-[inset_3px_0_0_var(--accent)]",
                  )}
                >
                  <span className={cn("whitespace-nowrap font-mono", row.blocked && "text-muted line-through decoration-danger")}>
                    {row.batch.batchNumber}
                  </span>
                  <span className="mt-0.5 block text-[0.78rem] text-muted sm:hidden">{expiry}</span>
                  <span className="mt-1.5 block sm:hidden">
                    <Chip tone={BAND_TONE[row.band]}>{p.bands[row.band]}</Chip>
                  </span>
                  {row.nextToSell && <span className="mt-0.5 block text-[0.76rem] font-medium text-accent-soft-ink">{p.next}</span>}
                </td>
                <td className="hidden border-b border-line px-3 py-3 align-middle text-muted sm:table-cell">{expiry}</td>
                <td className="border-b border-line py-3 pl-3 text-right align-middle font-mono tabular-nums sm:whitespace-nowrap sm:pr-3">
                  {formatStock(product, row.onHand)
                    .split(" + ")
                    .map((part, i) => (
                      <span key={part} className="whitespace-nowrap">
                        {i > 0 && " + "}
                        {part}
                      </span>
                    ))}
                </td>
                <td className="hidden border-b border-line py-3 pl-3 text-right align-middle sm:table-cell">
                  <Chip tone={BAND_TONE[row.band]}>{p.bands[row.band]}</Chip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3.5 text-right font-mono text-[0.84rem] text-muted tabular-nums">
        {fill(copy.counter.sellable, { qty: formatQty(sellableTotal(rows)) })}
      </p>
    </div>
  );
}

function LedgerTab({ copy, lang, state, reduce }: { copy: UiCopy; lang: Lang; state: DemoState; reduce: boolean }) {
  const p = copy.panels;
  const batchNumber = new Map(BATCHES.map((b) => [b.id, b.batchNumber]));
  const pending = state.outbox.flatMap((sale) => sale.events).map((event) => ({ event, pending: true }));
  const accepted = [...state.log].reverse().map((event) => ({ event, pending: false }));
  const rows = [...pending.reverse(), ...accepted];
  return (
    <div>
      <ul className="grid max-h-[22rem] gap-1.5 overflow-auto overscroll-contain" lang={lang}>
        <AnimatePresence initial={false}>
          {rows.map(({ event, pending: isPending }) => (
            <motion.li
              key={event.idempotencyKey}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reduce ? 0 : 0.3 }}
              className={cn(
                "grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-control px-3 py-2",
                isPending ? "border border-dashed border-warn/60" : "bg-sunk",
              )}
            >
              <span className="min-w-0 text-[0.82rem]">
                <span className="font-medium">{p.events[event.eventType] ?? event.eventType}</span>
                <span className="ml-2 font-mono text-muted">{event.reference.id}</span>
                {isPending && <span className="ml-2 text-warn">{p.pending}</span>}
                <span className="block font-mono text-[0.76rem] text-muted">
                  {productById(event.productId).name} · {event.batchId ? batchNumber.get(event.batchId) : "-"}
                </span>
              </span>
              <span className={cn("font-mono text-[0.88rem] tabular-nums", event.qtyDeltaBase < 0n ? "text-ink" : "text-accent")}>
                {signed(event.qtyDeltaBase)}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <p className="mt-3.5 flex gap-2 text-[0.84rem] text-muted">
        <LockSimple aria-hidden className="mt-0.5 size-4 shrink-0" />
        {p.ledgerNote}
      </p>
    </div>
  );
}

const OUTCOME_TONE = { ACCEPTED: "ok", DUPLICATE_IGNORED: "neutral", CONFLICT: "danger" } as const satisfies Record<string, ChipTone>;

function SyncTab({ copy, state, reduce }: { copy: UiCopy; state: DemoState; reduce: boolean }) {
  const p = copy.panels;
  if (state.syncLog.length === 0 && state.outbox.length === 0) {
    return (
      <p className="rounded-control border border-dashed border-line px-5 py-7 text-center text-[0.9rem] text-muted">
        <WifiSlash aria-hidden className="mx-auto mb-2 block size-6" />
        {p.syncEmpty}
      </p>
    );
  }
  return (
    <ul className="grid gap-1.5">
      {state.outbox.map((sale) => (
        <li
          key={sale.saleNo}
          className="flex items-center justify-between rounded-control border border-dashed border-warn/60 px-3 py-2.5 text-[0.82rem]"
        >
          <span className="font-mono">{sale.saleNo}</span>
          <Chip tone="warn">{p.pending}</Chip>
        </li>
      ))}
      {state.syncLog.map((entry, i) => (
        <motion.li
          key={`${entry.saleNo}/${entry.attempt}/${i}`}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : entry.attempt === 2 ? 0.35 : 0 }}
          className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-2.5 text-[0.82rem]"
        >
          <span>
            <span className="font-mono">{entry.saleNo}</span>
            <span className="ml-2 whitespace-nowrap text-muted">{fill(p.attempt, { n: entry.attempt })}</span>
          </span>
          <Chip tone={OUTCOME_TONE[entry.outcome]}>{p.outcomes[entry.outcome]}</Chip>
        </motion.li>
      ))}
    </ul>
  );
}

export default Demo;
