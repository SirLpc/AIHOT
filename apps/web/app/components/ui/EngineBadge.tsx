import { ENGINE_LABELS, engineProduct, type EngineEvidence } from '@aihot/industry/engine-identity';

/** Product identity is always visible, including phones; it is not an optional topic tag. */
export function EngineBadge({ item }: { item: EngineEvidence }) {
  const product = engineProduct(item);
  return <span data-engine-product={product} className="inline-flex max-w-full shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold leading-5 bg-accent-soft text-accent" title="产品身份不代表版本或 Package 兼容性">{ENGINE_LABELS[product]}</span>;
}
