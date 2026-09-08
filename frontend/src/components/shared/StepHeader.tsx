"use client";

import type { ReactNode } from "react";
import StepPageHeader from "./StepPageHeader";

export interface StepHeaderProps {
    stepNumber: number;
    totalSteps?: number;
    icon: ReactNode;
    englishName: string;
    title: string;
    subtitle: string;
    trailing?: ReactNode;
    className?: string;
}

export default function StepHeader({ className, stepNumber, englishName, title, subtitle, trailing }: StepHeaderProps) {
    return <div className={`shrink-0 ${className ?? ""}`}>
        <StepPageHeader stepNumber={stepNumber} englishName={englishName} title={title} subtitle={subtitle} trailing={trailing} />
    </div>;
}
