import { useRef, useState } from "react";
import { ImagePlus, X, Sparkles } from "lucide-react";
import { fileToResizedDataUrl, enhanceDataUrl } from "../lib/image.js";

const EXAMPLES = [
  "Check for new buyer messages and reply to anything unanswered",
  "Our USB-C charger is selling fast -- check current price against comparable listings and reprice it competitively",
  "The tablet stand shows 0 quantity -- check recent orders and restock it",
  "List a new item: wireless earbuds case, category electronics accessories, $12.99, qty 20",
];

function sellSpeedHint(speed: number): string {
  if (speed === 50) return "Normal market price";
  const diff = Math.abs(speed - 50);
  const intensity = diff >= 30 ? "much" : diff >= 15 ? "a fair bit" : "a little";
  return speed > 50 ? `Priced ${intensity} below market to sell faster` : `Priced ${intensity} above market to maximize profit`;
}

export function PromptInput({
  onSubmit,
  disabled,
}: {
  onSubmit: (prompt: string, imageDataUrl?: string, sellSpeed?: number) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [sellSpeed, setSellSpeed] = useState(50);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const trimmed = value.trim();
    if ((!trimmed && !image) || disabled) return;
    onSubmit(trimmed || "List this item for sale based on the attached photo.", image ?? undefined, sellSpeed);
    setValue("");
    setImage(null);
    setSellSpeed(50);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("That's not a photo -- pick a PNG, JPEG, or WEBP image.");
      return;
    }
    try {
      setImageError(null);
      const resized = await fileToResizedDataUrl(file);
      setImage(resized);
      setEnhancing(true);
      setImage(await enhanceDataUrl(resized));
    } catch {
      setImageError("Couldn't read that photo -- try a different one.");
    } finally {
      setEnhancing(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="glass rounded-2xl p-2 shadow-glow">
        {image && (
          <div className="relative m-2 inline-block">
            <img
              src={image}
              alt="Attached item photo"
              className={`h-20 w-20 rounded-lg object-cover transition-opacity ${enhancing ? "opacity-50" : ""}`}
            />
            {enhancing ? (
              <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30">
                <Sparkles size={16} className="animate-pulseSoft text-white/90" />
              </span>
            ) : (
              <span className="absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-accent-500/30 bg-black/80 px-1.5 py-0.5 text-[9px] font-medium text-accent-200">
                <Sparkles size={9} /> Enhanced
              </span>
            )}
            <button
              onClick={() => setImage(null)}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-white/80 hover:text-white"
              aria-label="Remove photo"
            >
              <X size={12} />
            </button>
          </div>
        )}
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={image ? "Anything else to add? (optional)" : "Tell your eBay team what to do, or attach a photo..."}
          rows={3}
          disabled={disabled}
          className="w-full resize-none bg-transparent px-4 py-3 text-[15px] text-white placeholder-white/35 outline-none disabled:opacity-50"
        />
        {imageError && <div className="px-3 pb-1 text-xs text-rose-300">{imageError}</div>}
        <div className="px-3 pb-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-white/40">
              Sell speed: <span className="font-medium text-white/70">{sellSpeed}</span>
            </span>
            <span className="text-white/35">{sellSpeedHint(sellSpeed)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={sellSpeed}
            disabled={disabled}
            onChange={(e) => setSellSpeed(Number(e.target.value))}
            className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-500 disabled:opacity-40"
          />
        </div>
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              title="Attach a photo of the item"
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 transition hover:border-white/20 hover:text-white/80 disabled:opacity-30"
            >
              <ImagePlus size={14} />
              Photo
            </button>
            <span className="hidden text-xs text-white/30 sm:inline">⌘/Ctrl + Enter to send</span>
          </div>
          <button
            onClick={submit}
            disabled={disabled || (!value.trim() && !image)}
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
