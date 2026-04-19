'use client';

import { useEffect } from 'react';
import { CTOChat } from '@/components/chat/CTOChat';
import { useWs } from '@/components/layout/DashboardShell';

export default function ChatPage() {
  const { send, connected } = useWs();

  useEffect(() => {
    document.title = 'CTO Chat — CTO Dashboard';
  }, []);

  return <CTOChat send={send} connected={connected} />;
}
