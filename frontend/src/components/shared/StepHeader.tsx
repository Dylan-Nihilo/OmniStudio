"use client";
/**
 * StepHeader — 统一 R2V workflow 4 个 step 的 page header（Charcoal v3）。
 *
 * 设计原则：
 *   - **字体分轨**：英文 chrome（eyebrow / ghost number）走 mono；
 *     中文标题 + 副标题走 sans (Inter→PingFang fallback)。
 *     Space Grotesk 在这一层不出现 —— 它的中文 fallback 偏粗，
 *     16px 中文已经足够"工具焦点"，不需要营销 hero 尺度。
 *   - **对齐 Omni Studio type scale**：标题 16px = display token 上限；
 *     副标题 12px = body-sm；eyebrow 9.5px mono uppercase 0.20em。
 *   - **克制 progress**：1px hairline + 节点，单色紫，无 glow / 无 pink halo。
 *     仅 current node 有微 ring（紫 10%），是全 panel 唯一的"有色信号"。
 *   - **Trailing slot 由 host 决定**：StepHeader 不知道每个 step 该放什么操作。
 *     ScriptProcessor 自己塞 [Save / Reparse]；ArtDirection 塞 [Apply]；
 *     VideoAssembly 塞 [Export] —— 各 host 的 business chrome。
 *
 * 用法见 docs/design-mocks/r2v-step-header-atelier-glow.html。
 */
import type { ReactNode } from "react";
import clsx from "clsx";

export interface StepHeaderProps {
    /** 1-based 当前步骤号；驱动 ghost number / eyebrow / progress current 位置。 */
    stepNumber: number;
    /** 总步骤数。R2V workflow 默认 4。 */
    totalSteps?: number;
    /** 左侧圆形 chip 里的 icon —— 调用方传 lucide icon，size + stroke 由 chip
     *  样式约束（14px / stroke-1.5），所以 host 直接传 `<Palette />` 即可。 */
    icon: ReactNode;
    /** 英文 eyebrow 名称（如 "Script" / "Style" / "Storyboard" / "Assembly"）。 */
    englishName: string;
    /** 中文标题（如 "脚本编辑器" / "风格定调" / "故事板" / "时间线组装"）。 */
    title: string;
    /** 中文副标题（一行点睛说明该 step 在做什么）。 */
    subtitle: string;
    /** 右侧操作 / 统计槽 —— host 自决。空时显示空白（不要 placeholder）。 */
    trailing?: ReactNode;
    /** 额外 className 注入到外层 panel（仅在特殊 layout 下使用）。 */
    className?: string;
}

export default function StepHeader({
    stepNumber,
    totalSteps = 4,
    icon,
    englishName,
    title,
    subtitle,
    trailing,
    className,
}: StepHeaderProps) {
    const stepStr = String(stepNumber).padStart(2, "0");

    // Progress bar fill 计算：当前 step 之前的所有 segments 完整填满，
    // 当前 step 用 current node。totalSteps=4 时，stepNumber=2 → fill 1/3 段。
    // 计算公式：完成段数 = stepNumber - 1，总段数 = totalSteps - 1。
    const progressPercent = totalSteps > 1
        ? Math.max(0, Math.min(1, (stepNumber - 1) / (totalSteps - 1))) * 100
        : 0;

    const nodes = Array.from({ length: totalSteps }, (_, i) => {
        const idx = i + 1;
        if (idx < stepNumber) return "done" as const;
        if (idx === stepNumber) return "current" as const;
        return "future" as const;
    });

    return (
        <div
            className={clsx(
                "relative h-28 w-full overflow-hidden border-b border-glass-border bg-surface",
                "transition-colors duration-base ease-out-quart",
                className,
            )}
        >
            {/* Main row — 留出底部 18px 给 progress rail */}
            <div className="relative z-[1] flex h-[calc(100%-18px)] items-center gap-4 px-6">
                {/* Icon chip — 32×32 圆形，flat dark + 紫 1px border + 内顶部 1px 高光 */}
                <div
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-primary"
                    style={{
                        background: "rgba(100, 108, 255, 0.06)",
                        border: "1px solid rgba(100, 108, 255, 0.32)",
                        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
                    }}
                >
                    {/* host 传的 lucide icon —— size/stroke 由全局 className 约束 */}
                    <span className="grid h-3.5 w-3.5 place-items-center [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:stroke-[1.5]">
                        {icon}
                    </span>
                </div>

                {/* Title block */}
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    {/* Eyebrow — 英文 chrome：01 — SCRIPT */}
                    <span className="mb-[1px] inline-flex items-center gap-2 font-mono text-[0.59375rem] font-normal uppercase leading-tight tracking-[0.2em] text-text-muted">
                        <span className="font-medium text-primary">{stepStr}</span>
                        <span aria-hidden="true" className="h-px w-3 bg-glass-border" />
                        <span>{englishName}</span>
                    </span>
                    {/* 中文标题 — Inter Medium 16px (Omni Studio display token 上限) */}
                    <span
                        className="text-[1rem] font-medium leading-[1.3] text-foreground"
                        style={{ letterSpacing: 0 }}
                    >
                        {title}
                    </span>
                    {/* 中文副标题 — body-sm 12px text-secondary */}
                    <span
                        className="text-[0.75rem] font-normal leading-[1.4] text-text-secondary"
                        style={{ letterSpacing: 0 }}
                    >
                        {subtitle}
                    </span>
                </div>

                {/* Ghost number — 现在作为 trailing 的视觉前导（inline，不再 absolute
                   背景层），永远不与 trailing button 重叠。`-my-8` 让 80px 字号
                   不撑爆 row，pointer-events-none + select-none 保持装饰性。 */}
                <span
                    aria-hidden="true"
                    className="ml-auto shrink-0 -my-8 select-none pointer-events-none font-mono leading-[0.85] tracking-[-0.05em]"
                    style={{
                        fontSize: "80px",
                        fontWeight: 300,
                        color: "rgba(255, 255, 255, 0.06)",
                    }}
                >
                    {stepStr}
                </span>

                {/* Trailing slot — host 自决，紧贴 ghost number 右侧 */}
                {trailing ? <div className="ml-4 z-[2] flex shrink-0 items-center gap-2">{trailing}</div> : null}
            </div>

            {/* Progress rail — 1px hairline + 节点（无 glow / 无 pink） */}
            <div className="absolute bottom-3 left-6 right-6 z-[1] h-1.5">
                <div
                    aria-hidden="true"
                    className="absolute left-1.5 right-1.5 top-1/2 h-px -translate-y-1/2"
                    style={{ background: "rgba(255, 255, 255, 0.06)" }}
                />
                <div
                    aria-hidden="true"
                    className="absolute left-1.5 top-1/2 h-px -translate-y-1/2 bg-primary opacity-55 transition-[width] duration-slow ease-out-quart"
                    style={{ width: `calc((100% - 12px) * ${progressPercent / 100})` }}
                />
                <div className="relative flex h-full items-center justify-between">
                    {nodes.map((kind, i) => (
                        <span
                            key={i}
                            aria-hidden="true"
                            className={clsx(
                                "shrink-0 rounded-full transition-all duration-base ease-out-quart",
                                kind === "done"
                                    ? "h-[5px] w-[5px] border border-primary bg-primary opacity-70"
                                    : kind === "current"
                                        ? "h-[7px] w-[7px] border border-primary bg-primary"
                                        : "h-[5px] w-[5px] border border-foreground/[0.18] bg-transparent opacity-50",
                            )}
                            style={
                                kind === "current"
                                    ? { boxShadow: "0 0 0 3px rgba(100, 108, 255, 0.10)" }
                                    : undefined
                            }
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
