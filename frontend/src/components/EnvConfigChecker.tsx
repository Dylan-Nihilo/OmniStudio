"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import EnvConfigDialog from "@/components/project/EnvConfigDialog";
import { api } from "@/lib/api";

export default function EnvConfigChecker() {
  const [isEnvDialogOpen, setIsEnvDialogOpen] = useState(false);
  const [envRequired, setEnvRequired] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    // 只在客户端执行，且只检查一次
    if (typeof window === 'undefined' || hasChecked) return;
    
    checkEnvConfig();
    setHasChecked(true);
  }, [hasChecked]);

  const checkEnvConfig = async () => {
    try {
      const config = await api.getEnvConfig();
      // 空值和空字符串都视为未配置
      const dashscopeKey = config.DASHSCOPE_API_KEY?.trim();
      const hasRequired = dashscopeKey && dashscopeKey.length > 0;
      
      if (!hasRequired) {
        setEnvRequired(true);
        setIsEnvDialogOpen(true);
      }
    } catch (error) {
      // An expired session is handled by apiClient, which redirects to the
      // login surface. Do not replace that auth error with a misleading
      // "DashScope API Key required" dialog.
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        return;
      }

      console.error("Failed to check env config:", error);
      // 对非认证错误保留原有的安全兜底：要求用户确认运行配置。
      setEnvRequired(true);
      setIsEnvDialogOpen(true);
    }
  };

  return (
    <EnvConfigDialog
      isOpen={isEnvDialogOpen}
      onClose={() => {
        setIsEnvDialogOpen(false);
        setEnvRequired(false);
      }}
      isRequired={envRequired}
    />
  );
}
