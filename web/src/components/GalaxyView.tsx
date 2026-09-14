import { useMemo } from "react";
import type { AgentRole, RunRecord, TaskRecord } from "../lib/types.js";
import { AGENT_META, shade } from "../lib/meta.js";
import { deriveStatus, currentTaskFor } from "./AgentCard.js";
import { WorkerMessageList } from "./WorkerMessageList.js";
import type { VoiceStatus } from "../hooks/useVoiceAssistant.js";

const WORKER_ORDER: AgentRole[] = ["listing", "pricing", "inventory", "messages", "compliance"];

type Point = { x: number; y: number };

function pointOnCircle(centerPct: number, radiusPct: number, angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: centerPct + radiusPct * Math.cos(rad),
    y: centerPct + radiusPct * Math.sin(rad),
  };
}

function useStarfield(count: number) {
  return useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => {
        const hero = i % 11 === 0;
        const tint = i % 7 === 0 ? "#bcd0ff" : i % 5 === 0 ? "#ffe3c2" : "#ffffff";
        return {
          id: i,
          x: Math.random() * 100,
          y: Math.random() * 100,
          size: hero ? Math.random() * 1.4 + 2.2 : Math.random() * 1.4 + 0.5,
          duration: 2 + Math.random() * 3.5,
          delay: Math.random() * 4,
          maxOpacity: hero ? 0.85 + Math.random() * 0.15 : 0.4 + Math.random() * 0.5,
          tint,
        };
      }),
    [count]
  );
}

const MANAGER_BOX = "h-24 w-24 sm:h-32 sm:w-32 md:h-40 md:w-40";

export function GalaxyView({
  run,
  tasks,
  voiceStatus,
}: {
  run: RunRecord;
  tasks: TaskRecord[];
  voiceStatus?: VoiceStatus;
}) {
  const stars = useStarfield(90);
  const listening = voiceStatus === "wake-listening" || voiceStatus === "capturing";
  const speaking = voiceStatus === "speaking";
  const managerBusy = run.status === "planning" || (run.status === "running" && tasks.every((t) => t.status === "completed"));
  const workingTask = tasks.find((t) => t.status === "running");
  const stuckTask = tasks.find((t) => t.status === "needs_retry" || t.status === "blocked");
  const activeRole = (workingTask ?? stuckTask)?.agentRole;

  const CENTER = 50;
  const RADIUS = 40;

  const managerMeta = AGENT_META.manager;
  const ManagerIcon = managerMeta.icon;
  const haloColor = speaking ? "rgba(139, 147, 255, 0.7)" : "rgba(108, 246, 160, 0.65)";
  const haloBorder = speaking ? "#8b93ff" : "#6cf6a0";

  const planets = WORKER_ORDER.map((role, i) => {
    const angle = -90 + i * (360 / WORKER_ORDER.length);
    const pos = pointOnCircle(CENTER, RADIUS, angle);
    const roleTasks = tasks.filter((t) => t.agentRole === role);
    const status = deriveStatus(roleTasks);
    const current = currentTaskFor(roleTasks);
    const involved = roleTasks.length > 0;
    const isActive = role === activeRole;
    return { role, pos, angle, status, current, involved, isActive };
  });

  return (
    <div className="flex flex-col gap-4 md:flex-row md:h-[620px]">
      <div className="order-2 w-full shrink-0 md:order-1 md:h-full md:w-72">
        <WorkerMessageList run={run} tasks={tasks} />
      </div>
      <div className="glass relative order-1 flex-1 overflow-hidden rounded-2xl border border-white/10 p-4 md:order-2">
        <div className="relative mx-auto aspect-square w-full max-w-[680px]">
          {/* Nebula wash */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
            <div
              className="nebula-drift absolute -left-1/4 -top-1/4 h-3/4 w-3/4 rounded-full blur-3xl"
              style={{ background: "radial-gradient(circle, rgba(139,147,255,0.22), transparent 70%)" }}
            />
            <div
              className="nebula-drift-rev absolute -bottom-1/4 -right-1/4 h-3/4 w-3/4 rounded-full blur-3xl"
              style={{ background: "radial-gradient(circle, rgba(108,246,160,0.16), transparent 70%)" }}
            />
            <div
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ background: "radial-gradient(circle, transparent 55%, rgba(0,0,0,0.35) 100%)" }}
            />
          </div>

          {/* Starfield */}
          <div className="absolute inset-0 overflow-hidden rounded-full">
            {stars.map((s) => (
              <span
                key={s.id}
                className="star-twinkle absolute rounded-full"
                style={
                  {
                    left: `${s.x}%`,
                    top: `${s.y}%`,
                    width: `${s.size}px`,
                    height: `${s.size}px`,
                    background: s.tint,
                    boxShadow: s.size > 2 ? `0 0 6px 1px ${s.tint}` : undefined,
                    "--twinkle-duration": `${s.duration}s`,
                    "--twinkle-delay": `${s.delay}s`,
                    "--twinkle-max": s.maxOpacity,
                    "--twinkle-min": 0.1,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>

          {/* Ambient decorative rings */}
          <svg viewBox="0 0 100 100" className="galaxy-ring-spin pointer-events-none absolute inset-0 h-full w-full opacity-[0.15]">
            <circle cx="50" cy="50" r="47" fill="none" stroke="#8b93ff" strokeWidth="0.15" strokeDasharray="0.5 2.5" />
          </svg>
          <svg viewBox="0 0 100 100" className="galaxy-ring-spin-rev pointer-events-none absolute inset-0 h-full w-full opacity-[0.1]">
            <circle cx="50" cy="50" r="44" fill="none" stroke="#6cc6f6" strokeWidth="0.12" strokeDasharray="0.3 3" />
          </svg>

          {/* Orbit rings + connecting lines */}
          <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full">
            <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.25" />
            {planets.map((p) => {
              const meta = AGENT_META[p.role];
              return (
                <line
                  key={p.role}
                  x1={CENTER}
                  y1={CENTER}
                  x2={p.pos.x}
                  y2={p.pos.y}
                  stroke={p.isActive ? meta.color : "rgba(255,255,255,0.08)"}
                  strokeWidth={p.isActive ? 0.6 : 0.2}
                  className={p.isActive ? "orbit-flow" : ""}
                  style={p.isActive ? { filter: `drop-shadow(0 0 3px ${meta.color})` } : undefined}
                />
              );
            })}
          </svg>

          {/* Manager -- the big guy, styled as a giant ringed planet */}
          <div
            className="absolute flex flex-col items-center"
            style={{ left: `${CENTER}%`, top: `${CENTER}%`, transform: "translate(-50%, -50%)" }}
          >
            <div className={`relative ${MANAGER_BOX}`}>
              {(listening || speaking) && (
                <span
                  className="halo-pulse absolute -inset-5 rounded-full border-2 md:-inset-7"
                  style={{ borderColor: haloBorder, "--halo-color": haloColor } as React.CSSProperties}
                />
              )}

              {/* Ring, back half (renders behind the sphere) */}
              <span
                className={`absolute left-1/2 top-1/2 h-[40%] w-[175%] rounded-full border-[3px] ${managerBusy ? "manager-glow" : ""}`}
                style={{
                  transform: "translate(-50%, -50%) rotate(-14deg)",
                  borderColor: `${managerMeta.color}70`,
                  boxShadow: `0 0 18px ${managerMeta.color}30`,
                }}
              />

              {/* Sphere */}
              <span
                className={`absolute inset-0 flex items-center justify-center rounded-full text-lg font-bold text-black/80 ${
                  managerBusy ? "manager-pulse manager-glow" : ""
                }`}
                style={{
                  backgroundImage: [
                    `radial-gradient(circle at 32% 26%, rgba(255,255,255,0.7), rgba(255,255,255,0) 45%)`,
                    `repeating-linear-gradient(178deg, rgba(255,255,255,0.10) 0px, rgba(255,255,255,0.10) 5px, rgba(0,0,0,0.10) 5px, rgba(0,0,0,0.10) 12px)`,
                    `radial-gradient(circle at 50% 48%, ${shade(managerMeta.color, 40)}, ${managerMeta.color} 55%, ${shade(managerMeta.color, -35)} 100%)`,
                  ].join(", "),
                  boxShadow: `inset -8px -10px 26px rgba(0,0,0,0.35), 0 0 30px ${managerMeta.color}55`,
                }}
                title={managerMeta.name}
              >
                <ManagerIcon size={36} strokeWidth={2} className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)] text-black/70" />
              </span>

              {/* Ring, front half (renders in front of the sphere, over the bottom) */}
              <span
                className={`absolute left-1/2 top-1/2 h-[40%] w-[175%] rounded-full border-[3px] ${managerBusy ? "manager-glow" : ""}`}
                style={{
                  transform: "translate(-50%, -50%) rotate(-14deg)",
                  borderColor: `${managerMeta.color}95`,
                  clipPath: "inset(50% 0 0 0)",
                  boxShadow: `0 0 18px ${managerMeta.color}40`,
                }}
              />
            </div>
            <span className="mt-3 text-base font-semibold text-white/90 md:text-lg">{managerMeta.name}</span>
            <span className="text-[11px] uppercase tracking-wide text-white/45">{managerMeta.label}</span>
            {(listening || speaking) && (
              <span className="mt-1 text-[10px] font-medium" style={{ color: haloBorder }}>
                {speaking ? "speaking…" : voiceStatus === "capturing" ? "listening…" : "hey galaxy?"}
              </span>
            )}
          </div>

          {/* Planets (workers) */}
          {planets.map((p) => {
            const meta = AGENT_META[p.role];
            const Icon = meta.icon;
            const dim = !p.involved;
            return (
              <div
                key={p.role}
                className="absolute flex flex-col items-center"
                style={{ left: `${p.pos.x}%`, top: `${p.pos.y}%`, transform: "translate(-50%, -50%)" }}
              >
                <span
                  className={`relative flex h-14 w-14 items-center justify-center rounded-full transition-all sm:h-16 sm:w-16 ${
                    p.isActive ? "planet-pulse" : ""
                  }`}
                  style={{
                    backgroundImage: dim
                      ? undefined
                      : [
                          `radial-gradient(circle at 30% 26%, rgba(255,255,255,0.55), rgba(255,255,255,0) 50%)`,
                          `radial-gradient(circle at 50% 50%, ${shade(meta.color, 30)}, ${meta.color} 58%, ${shade(meta.color, -30)} 100%)`,
                        ].join(", "),
                    background: dim ? "rgba(255,255,255,0.05)" : undefined,
                    border: `1.5px solid ${dim ? "rgba(255,255,255,0.12)" : shade(meta.color, -15)}`,
                    boxShadow: p.isActive ? `0 0 22px 3px ${meta.color}90, inset -4px -5px 10px rgba(0,0,0,0.3)` : dim ? "none" : "inset -4px -5px 10px rgba(0,0,0,0.3)",
                    opacity: dim ? 0.35 : 1,
                  }}
                  title={`${meta.name} — ${meta.label}`}
                >
                  <Icon size={20} strokeWidth={2.25} color={dim ? "#ffffff88" : "#0b0d12"} className="drop-shadow-[0_1px_1px_rgba(255,255,255,0.25)]" />
                  {p.status === "done" && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-400 text-[8px] text-emerald-950">
                      ✓
                    </span>
                  )}
                  {p.status === "failed" && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-rose-400" />
                  )}
                </span>
                <span className={`mt-1.5 text-[12px] font-medium ${dim ? "text-white/30" : "text-white/90"}`}>{meta.name}</span>
                <span className={`text-[10px] ${dim ? "text-white/20" : "text-white/45"}`}>{meta.label}</span>

                {p.isActive && p.current && (
                  <div
                    className="glass absolute top-full z-10 mt-2 w-40 rounded-lg border p-2 text-center text-[10px] leading-snug text-white/70 shadow-glow"
                    style={{ borderColor: `${meta.color}55` }}
                  >
                    {p.current.title}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
