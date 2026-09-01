"use client";
/**
 * WorkflowActionButton — R2V workflow 统一 primary action 按钮。
 *
 * 视觉灵感：ZeroNode 项目的 frosted glass pill —— pill 形状 + 顶部高光
 * + 半透明品牌色 + backdrop-blur，让按钮看起来"漂浮"在 dark glass 之上。
 *
 * 适配 Omni Studio：
 *   · 用紫色 #646cff 替代蓝色（与 BorderGlow / StepHeader / 整体品牌一致）
 *   · backdrop-blur 落到 Omni Studio 已有的 glass 语言里
 *   · 顶部 inset highlight 约 1px 白色 4-5% —— 极克制，不喧宾
 *   · 三档 variant：
 *       - primary  : 紫色填充 + 顶部高光，主行动（"应用并继续" / "Generate ×N"）
 *       - secondary: 紫色 outline + 极浅紫填充，次行动（"导入" / "保存"）
 *       - ghost    : 透明 + 紫文字 + hover 显玻璃，纯导航（"取消" / 占位）
 *   · loading 态：左前显 spinner，禁交互
 *   · disabled 态：opacity 50% + cursor not-allowed
 *
 * 禁用 motion.button 包装 —— scale-95 active 已足够，不再加 framer-motion 重器。
 */
import { Loader2 } from "lucide-react";
import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

interface WorkflowActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
    /** primary = 主行动（紫色填充 frosted）
     *  secondary = 次行动（紫 outline + 极浅紫底）
     *  ghost = 纯导航（透明 + hover 显玻璃） */
    variant?: Variant;
    /** sm = 28px 高 (chrome 内嵌)；md = 36px 高（标准 step trailing）。 */
    size?: Size;
    /** 左 icon（可选）；与 children 之间有 1.5 间距。 */
    leftIcon?: ReactNode;
    /** 右 icon（可选）；常用于 ChevronRight "继续" 暗示。 */
    rightIcon?: ReactNode;
    /** loading 时左 icon 自动换 spinner，按钮禁用，文字不变。 */
    loading?: boolean;
    children: ReactNode;
}

/* ───────────────────────────────────────────────────────────────────
   Variant 风格表
   每档样式写在这里，避免 className 拼接里塞条件，可读性更好。
   ─────────────────────────────────────────────────────────────────── */
const variantStyles: Record<Variant, string> = {
    /* Primary — 实色紫 fill + frosted 顶部高光。
       v2 调整：把 frosted 从"身体半透明"挪到"顶部反射"——身体保持紫色实色
       让对比度足够（在 #050508 dark bg 上白字读得清），仅顶部 1.5px 白色 14%
       inset 高光模拟"玻璃球反射"。底部加 inset 紫暗边 + outer 紫 glow。 */
    primary: clsx(
        "text-foreground",
        "bg-primary",
        "border border-[rgba(100,108,255,0.65)]",
        "shadow-[inset_0_1.5px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(60,68,200,0.45),0_4px_14px_-2px_rgba(100,108,255,0.45)]",
        "hover:bg-primary-hover",
        "hover:border-[rgba(100,108,255,0.85)]",
        "hover:shadow-[inset_0_1.5px_0_rgba(255,255,255,0.20),inset_0_-1px_0_rgba(60,68,200,0.55),0_6px_18px_-2px_rgba(100,108,255,0.60)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
    ),
    /* Secondary — 紫 outline + 浅紫 frosted 底。
       身体仍是 frosted（10% 紫 + backdrop-blur），border 紫 40%。
       hover 加深到接近 primary 但更轻。 */
    secondary: clsx(
        "text-primary",
        "bg-[rgba(100,108,255,0.10)]",
        "border border-[rgba(100,108,255,0.40)]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
        "backdrop-blur-md",
        "hover:bg-[rgba(100,108,255,0.22)] hover:border-[rgba(100,108,255,0.60)] hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55",
    ),
    /* Ghost — 透明，hover 才显玻璃。最低权重的导航 / 取消按钮。 */
    ghost: clsx(
        "text-text-secondary bg-transparent border border-transparent",
        "hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground hover:border-glass-border",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55",
    ),
};

const sizeStyles: Record<Size, string> = {
    sm: "min-h-[30px] px-3.5 text-[0.78125rem] gap-1.5",
    md: "min-h-[38px] px-5 text-[0.8125rem] gap-2",
};

export default function WorkflowActionButton({
    variant = "primary",
    size = "md",
    leftIcon,
    rightIcon,
    loading = false,
    disabled,
    className,
    children,
    type = "button",
    ...rest
}: WorkflowActionButtonProps) {
    const isDisabled = disabled || loading;
    return (
        <button
            type={type}
            disabled={isDisabled}
            className={clsx(
                // pill — rounded-full 是核心标识，所有 variant 共享
                "inline-flex items-center justify-center rounded-full font-semibold",
                // 字体走 sans (Inter→PingFang fallback)，符合 Omni Studio content tier
                "font-sans tracking-[-0.005em]",
                "select-none whitespace-nowrap",
                "transition-[background,border-color,box-shadow,transform] duration-fast ease-out-quart",
                "active:scale-[0.97]",
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
                sizeStyles[size],
                variantStyles[variant],
                className,
            )}
            {...rest}
        >
            {loading ? (
                <Loader2 className="animate-spin" size={size === "sm" ? 12 : 14} aria-hidden="true" />
            ) : leftIcon ? (
                <span className="grid place-items-center [&>svg]:h-3.5 [&>svg]:w-3.5">{leftIcon}</span>
            ) : null}
            <span>{children}</span>
            {rightIcon && !loading ? (
                <span className="grid place-items-center [&>svg]:h-3.5 [&>svg]:w-3.5">{rightIcon}</span>
            ) : null}
        </button>
    );
}
