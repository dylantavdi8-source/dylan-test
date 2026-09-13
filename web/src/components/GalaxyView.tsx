import { useMemo } from "react";
import type { AgentRole, RunRecord, TaskRecord } from "../lib/types.js";
import { AGENT_META } from "../lib/meta.js";
import { deriveStatus, currentTaskFor } from "./AgentCard.js";

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
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 1.6 + 0.6,
        duration: 2 + Math.random() * 3.5,
        delay: Math.random() * 4,
        maxOpacity: 0.4 + Math.random() * 0.6,
      })),
    [count]
  );
}

export function GalaxyView({ run, tasks }: { run: RunRecord; tasks: TaskRecord[] }) {
  const stars = useStarfield(70);
  const managerBusy = run.status === "planning" || (run.status === "running" && tasks.every((t) => t.status === "completed"));
  const workingTask = tasks.find((t) => t.status === "running");
  const stuckTask = tasks.find((t) => t.status === "needs_retry" || t.status === "blocked");
  const activeRole = (workingTask ?? stuckTask)?.agentRole;

  const CENTER = 50;
  const RADIUS = 37;

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
    <div className="glass relative overflow-hidden rounded-2xl border border-white/10 p-4">
      <div className="relative mx-auto aspect-square w-full max-w-[560px]">
        {/* Starfield */}
        <div className="absolute inset-0 overflow-hidden rounded-full">
          {stars.map((s) => (
            <span
              key={s.id}
              className="star-twinkle absolute rounded-full bg-white"
              style={
                {
                  left: `${s.x}%`,
                  top: `${s.y}%`,
                  width: `${s.size}px`,
                  height: `${s.size}px`,
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
          <circle cx="50" cy="50" r="46" fill="none" stroke="#8b93ff" strokeWidth="0.15" strokeDasharray="0.5 2.5" />
        </svg>
        <svg viewBox="0 0 100 100" className="galaxy-ring-spin-rev pointer-events-none absolute inset-0 h-full w-full opacity-[0.1]">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#6cc6f6" strokeWidth="0.12" strokeDasharray="0.3 3" />
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

        {/* Sun (manager) */}
        <div
          className="absolute flex flex-col items-center"
          style={{ left: `${CENTER}%`, top: `${CENTER}%`, transform: "translate(-50%, -50%)" }}
        >
          <span
            className={`flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-black/80 ${managerBusy ? "sun-pulse planet-pulse" : ""}`}
            style={{ background: `radial-gradient(circle at 35% 30%, #fde9b8, ${AGENT_META.manager.color})` }}
            title="Manager"
          >
            {(() => {
              const Icon = AGENT_META.manager.icon;
              return <Icon size={26} strokeWidth={2.25} className="text-black/70" />;
            })()}
          </span>
          <span className="mt-1.5 text-[11px] font-medium text-white/70">Manager</span>
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
                className={`relative flex h-11 w-11 items-center justify-center rounded-full transition-all ${p.isActive ? "planet-pulse" : ""}`}
                style={{
                  background: dim ? "rgba(255,255,255,0.05)" : `${meta.color}${p.isActive ? "33" : "20"}`,
                  border: `1.5px solid ${dim ? "rgba(255,255,255,0.12)" : meta.color}`,
                  boxShadow: p.isActive ? `0 0 18px 2px ${meta.color}88` : "none",
                  opacity: dim ? 0.35 : 1,
                }}
                title={meta.label}
              >
                <Icon size={18} strokeWidth={2.25} color={dim ? "#ffffff88" : meta.color} />
                {p.status === "done" && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-400 text-[8px] text-emerald-950">
                    ✓
                  </span>
                )}
                {p.status === "failed" && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-rose-400" />
                )}
              </span>
              <span className={`mt-1.5 text-[11px] font-medium ${dim ? "text-white/30" : "text-white/75"}`}>{meta.label}</span>

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
  );
}
