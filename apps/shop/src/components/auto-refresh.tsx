"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({ sekunden }: { sekunden: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), sekunden * 1000);
    return () => clearInterval(t);
  }, [router, sekunden]);
  return null;
}
