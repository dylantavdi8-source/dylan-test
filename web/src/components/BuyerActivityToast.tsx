import { Bell, MessageCircle, HandCoins, X } from "lucide-react";
import type { BuyerActivity } from "../lib/types.js";

export function BuyerActivityToast({
  activity,
  onDismiss,
  onHandle,
}: {
  activity: BuyerActivity;
  onDismiss: () => void;
  onHandle: () => void;
}) {
  const isMessage = activity.kind === "message";
  const buyer = isMessage ? activity.message.buyerUsername : activity.offer.buyerUsername;
  const title = isMessage ? activity.message.listingTitle : activity.offer.listingTitle;
  const Icon = isMessage ? MessageCircle : HandCoins;

  return (
    <div className="glass fixed bottom-5 left-5 z-40 w-[min(360px,calc(100vw-2.5rem))] rounded-2xl border border-accent-500/30 p-4 shadow-glow">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-accent-300">
          <Bell size={16} className="animate-pulseSoft" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white/90">
            <Icon size={13} />
            {isMessage ? "New buyer message" : "New offer"}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-white/55">
            {buyer} on <span className="text-white/70">{title ?? "a listing"}</span>
            {!isMessage && <span className="text-accent-300"> · ${activity.offer.offerPrice.toFixed(2)}</span>}
          </div>
          {isMessage && <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/40">{activity.message.body}</div>}
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={onHandle}
              className="rounded-lg bg-accent-500 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-accent-400"
            >
              Handle it
            </button>
            <button
              onClick={onDismiss}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-white/50 transition hover:text-white/80"
            >
              Dismiss
            </button>
          </div>
        </div>
        <button onClick={onDismiss} className="text-white/30 hover:text-white/70" aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
