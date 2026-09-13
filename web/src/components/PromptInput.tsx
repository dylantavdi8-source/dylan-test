import { useState } from "react";

const EXAMPLES = [
  "Check for new buyer messages and reply to anything unanswered",
  "Our USB-C charger is selling fast -- check current price against comparable listings and reprice it competitively",
  "The tablet stand shows 0 quantity -- check recent orders and restock it",
  "List a new item: wireless earbuds case, category electronics accessories, $12.99, qty 20",
];

export function PromptInput({ onSubmit, disabled }: { onSubmit: (prompt: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="glass rounded-2xl p-2 shadow-glow">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Tell your eBay team what to do..."
          rows={3}
          disabled={disabled}
          className="w-full resize-none bg-transparent px-4 py-3 text-[15px] text-white placeholder-white/35 outline-none disabled:opacity-50"
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="text-xs text-white/30">⌘/Ctrl + Enter to send</span>
          <button
            onClick={submit}
            disabled={disabled || !value.trim()}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {disabled ? "Working…" : "Send to the team"}
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            disabled={disabled}
            onClick={() => setValue(ex)}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/50 transition hover:border-white/20 hover:text-white/80 disabled:opacity-30"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
