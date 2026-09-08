"use client";

import { Button, type ButtonProps } from "@omnistudio/ui";
import type { ReactNode } from "react";

interface WorkflowActionButtonProps extends Omit<ButtonProps, "children" | "variant" | "isDisabled" | "isPending"> {
    variant?: "primary" | "secondary" | "ghost";
    size?: "sm" | "md";
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
    loading?: boolean;
    disabled?: boolean;
    title?: string;
    children: ReactNode;
}

// Preserve existing workflow callers while using the shared controls and pending behavior.
export default function WorkflowActionButton({
    variant = "primary", size = "md", leftIcon, rightIcon, loading = false,
    disabled, onClick, children, type = "button", ...rest
}: WorkflowActionButtonProps) {
    return (
        <Button {...rest} type={type} variant={variant === "ghost" ? "quiet" : variant}
            size={size} isDisabled={disabled} isPending={loading} onClick={loading || disabled ? undefined : onClick}>
            {!loading && leftIcon}
            {children}
            {!loading && rightIcon}
        </Button>
    );
}
