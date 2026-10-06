import { breakdown, formatQty } from "@apotek/domain";
import { Chip, Panel } from "@apotek/ui";
import { fill, type Copy } from "@/content/copy";
import { localToday } from "@/demo/dates";
import { initialState, sellableTotal, stockCard } from "@/demo/engine";
import { productById } from "@/demo/seed";

/**
 * Hero visual: the paracetamol stock card, computed by the domain package from
 * the demo seed. Expiry is relative to today, so it never goes stale.
 */
export function StockPreview({ copy }: { copy: Copy["stockPreview"] }) {
  const product = productById("pct");
  const unitName = new Map(product.units.map((u) => [u.id, u.name]));
  const rows = stockCard(initialState(localToday()), product.id);
  const sellable = sellableTotal(rows);

  return (
    <Panel raised aria-label={`${copy.title}, ${copy.product}`}>
      <div className="flex items-end justify-between gap-4 border-b border-line px-4 pb-3.5 pt-4 md:px-5">
        <div>
          <p className="text-[0.8rem] leading-tight text-muted">{copy.title}</p>
          <p className="mt-0.5 font-semibold leading-tight">{copy.product}</p>
        </div>
        <div className="text-right">
          <p className="text-[0.8rem] leading-tight text-muted">{copy.sellable}</p>
          <p className="font-mono text-2xl font-medium leading-tight tracking-[-0.02em] tabular-nums">
            {formatQty(sellable)} <span className="font-sans text-[0.8rem] text-muted">tablet</span>
          </p>
        </div>
      </div>
      <ul>
        {rows.map((row) => {
          const parts = breakdown(row.onHand, product.units)
            .map((line) => `${formatQty(line.qty)} ${unitName.get(line.unitId)}`)
            .join(" + ");
          return (
            <li
              key={row.batch.id}
              className={`grid grid-cols-[1fr_auto] items-center gap-x-3.5 gap-y-px border-t border-line px-4 py-2.5 first:border-t-0 md:px-5 ${
                row.nextToSell ? "bg-accent-soft/70" : ""
              }`}
            >
              <span
                className={`font-mono text-[0.9rem] font-medium ${
                  row.blocked ? "text-muted line-through decoration-danger" : ""
                }`}
              >
                {row.batch.batchNumber}
              </span>
              <span className="text-right font-mono text-[0.86rem] tabular-nums">{parts}</span>
              <span className="text-[0.8rem] text-muted">
                {row.daysToExpiry < 0
                  ? fill(copy.expiredAgo, { n: -row.daysToExpiry })
                  : fill(copy.expiresIn, { n: row.daysToExpiry })}
              </span>
              <span className="justify-self-end">
                {row.blocked ? <Chip tone="danger">{copy.blocked}</Chip> : row.nextToSell ? <Chip tone="next">{copy.next}</Chip> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-4 pb-3 pt-2.5 text-[0.78rem] text-muted md:px-5">{copy.caption}</p>
    </Panel>
  );
}
