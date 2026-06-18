"use client";

import { useCallback } from "react";

interface Props {
  targetRef: React.RefObject<HTMLDivElement | null>;
  filename?: string;
}

export default function ExportButton({ targetRef, filename = "expense-report" }: Props) {
  const handleExport = useCallback(async () => {
    if (!targetRef.current) return;

    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(targetRef.current, {
      backgroundColor: "#f8fafc",
      scale: 2,
      logging: false,
      useCORS: true,
    });

    const link = document.createElement("a");
    link.download = `${filename}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [targetRef, filename]);

  return (
    <button
      onClick={handleExport}
      className="inline-flex items-center gap-2 py-2.5 px-5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
          clipRule="evenodd"
        />
      </svg>
      Export as PNG
    </button>
  );
}
