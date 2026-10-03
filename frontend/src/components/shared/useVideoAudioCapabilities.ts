"use client";
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { VideoAudioCapabilities } from '@/lib/audioPolicy';
import { useAuthStore } from '@/store/authStore';

export function useVideoAudioCapabilities() {
    const workspace = useAuthStore(state => state.activeWorkspace?.id);
    const [capabilities, setCapabilities] = useState<Record<string, VideoAudioCapabilities>>({});
    useEffect(() => {
        let active = true;
        setCapabilities({});
        api.getVideoAudioCapabilities().then(value => { if (active) setCapabilities(value); }).catch(() => {});
        return () => { active = false; };
    }, [workspace]);
    return capabilities;
}
