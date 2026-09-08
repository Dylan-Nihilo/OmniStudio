"use client";
/**
 * ToastContainer — bottom-right stack of project-aware notifications.
 * Mounted once at the app root (Providers.tsx) so toasts survive
 * page/project navigation.
 */
import { useState } from "react";
import { Button, IconButton } from "@omnistudio/ui";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useToastStore, type Toast, type ToastKind } from "@/store/toastStore";

export const getWarningToastClasses = () =>
    "border-status-processing-border bg-elevated text-foreground";

const KIND_STYLES: Record<ToastKind, { ring: string; bg: string; icon: React.ReactElement; iconClass: string; titleClass?: string }> = {
    info: {
        ring: "border-border-default",
        bg: "bg-surface",
        icon: <Info size={14} />,
        iconClass: "text-primary",
    },
    progress: {
        ring: "border-border-default",
        bg: "bg-surface",
        icon: <Loader2 size={14} className="animate-spin" />,
        iconClass: "text-primary",
    },
    success: {
        ring: "border-status-completed-border",
        bg: "bg-surface",
        icon: <CheckCircle2 size={14} />,
        iconClass: "text-status-completed-fg",
    },
    error: {
        ring: "border-status-failed-border",
        bg: "bg-surface",
        icon: <AlertCircle size={14} />,
        iconClass: "text-status-failed-fg",
    },
    warning: {
        ring: "border-status-processing-border",
        bg: "bg-elevated",
        icon: <AlertTriangle size={14} />,
        iconClass: "text-foreground",
        titleClass: "text-foreground",
    },
};

function ToastCard({ toast }: { toast: Toast }) {
    const tc = useTranslations("common");
    const reducedMotion = useReducedMotion();
    const [copyResult, setCopyResult] = useState<"copied" | "copyFailed" | null>(null);
    const dismiss = useToastStore((s) => s.dismiss);
    const style = KIND_STYLES[toast.kind];
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: reducedMotion ? 0 : 24 }}
            transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            role={toast.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto w-[min(340px,calc(100vw-32px))] rounded-xl border ${style.ring} ${style.bg} shadow-md px-4 py-3 flex items-start gap-3 break-words`}
        >
            <span className={`mt-0.5 shrink-0 ${style.iconClass}`}>{style.icon}</span>
            <div className="min-w-0 flex-1">
                {toast.projectTitle && (
                    <p className="font-mono text-[0.59375rem] uppercase tracking-[0.16em] text-text-muted mb-0.5 truncate">
                        {toast.projectTitle}
                    </p>
                )}
                <p className={`text-[0.8125rem] font-medium leading-snug ${style.titleClass || "text-foreground"}`}>{toast.title}</p>
                {toast.body && (
                    <div className="mt-0.5">
                        <p className={`text-[0.71875rem] text-text-secondary leading-snug ${toast.body.length > 120 && copyResult !== "copyFailed" ? "line-clamp-3" : ""}`}>
                            {toast.body}
                        </p>
                        {(toast.kind === "error" && toast.body.length > 40) && (
                            <Button variant="quiet" size="sm" className="mt-1" onPress={async () => {
                                try { await navigator.clipboard.writeText(toast.body!); setCopyResult("copied"); }
                                catch { setCopyResult("copyFailed"); }
                            }}>
                                {tc(copyResult ?? "copyErrorDetails")}
                            </Button>
                        )}
                    </div>
                )}
                {toast.action && (
                    <Button variant="secondary" size="sm" className="mt-2"
                        onPress={() => {
                            toast.action!.onClick();
                            dismiss(toast.id);
                        }}
                    >
                        {toast.action.label}
                    </Button>
                )}
            </div>
            <IconButton
                onPress={() => dismiss(toast.id)}
                aria-label={tc("dismiss")}
                className="shrink-0 -mr-2 -mt-1"
            >
                <X size={16} />
            </IconButton>
        </motion.div>
    );
}

export default function ToastContainer() {
    const toasts = useToastStore((s) => s.toasts);
    return (
        <div className="pointer-events-none fixed bottom-[calc(72px+env(safe-area-inset-bottom))] md:bottom-4 right-4 z-[200] flex flex-col-reverse gap-2 max-h-[calc(100dvh-100px)] overflow-y-auto">
            <AnimatePresence initial={false}>
                {toasts.map((t) => (
                    <ToastCard key={t.id} toast={t} />
                ))}
            </AnimatePresence>
        </div>
    );
}
